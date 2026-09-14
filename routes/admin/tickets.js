
// routes/admin/tickets.js
const express = require("express");
const router = express.Router();
const Ticket = require("../../models/Ticket");
const Admin = require("../../models/Admin");
const { auth, requireRole } = require("../../middlewares/auth");

// ✅ CONSTANTS
const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  ON_HOLD: 'on_hold',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

const TICKET_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
};

// ✅ HELPER: Check if admin can access ticket
const canAdminAccessTicket = (ticket, adminId, adminRole) => {
  // Super admin can access all
  if (adminRole === 'super_admin') return true;

  // Admin/Support can access if:
  // 1. Ticket is unassigned
  // 2. Ticket is assigned to them
  // 3. They are admin (not support) and ticket is assigned to any admin
  if (adminRole === 'admin') {
    return !ticket.assignedTo?.adminId ||
      ticket.assignedTo.adminId.toString() === adminId.toString();
  }

  // Support can only access if assigned to them or unassigned
  if (adminRole === 'support') {
    return !ticket.assignedTo?.adminId ||
      ticket.assignedTo.adminId.toString() === adminId.toString();
  }

  if (adminRole === 'customer') {
    return !ticket.assignedTo?.adminId ||
      ticket.assignedTo.adminId.toString() === adminId.toString();
  }

  return false;
};

// ============================ ADMIN/SUPPORT TICKET ROUTES ============================

// ✅ GET TICKETS (Admin/Support - Filtered Access)
router.get("/", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const {
      status,
      priority,
      category,
      assignedTo,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (page - 1) * limit;

    // Build filter based on role
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    // Admin/support can only see:
    // 1. Tickets assigned to them
    // 2. Unassigned tickets
    // 3. All tickets if they are admin (not support)
    if (req.admin.role === 'admin') {
      if (assignedTo === 'me') {
        filter['assignedTo.adminId'] = req.admin._id;
      } else if (assignedTo === 'unassigned') {
        filter['assignedTo.adminId'] = { $exists: false };
      } else {
        // Admin can see all (including assigned to others)
        // No additional filter needed
      }
    } else if (req.admin.role === 'support') {
      // Support can only see assigned to them or unassigned
      filter.$or = [
        { 'assignedTo.adminId': req.admin._id },
        { 'assignedTo.adminId': { $exists: false } }
      ];
    }

    const tickets = await Ticket.find(filter)
      .populate('assignedTo.adminId', 'name email')
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('ticketId subject category status priority userInfo assignedTo createdAt updatedAt');

    const total = await Ticket.countDocuments(filter);

    // Get stats for dashboard
    const stats = await Ticket.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusStats = {};
    stats.forEach(stat => {
      statusStats[stat._id] = stat.count;
    });

    res.json({
      success: true,
      data: tickets,
      stats: {
        total,
        byStatus: statusStats,
        open: statusStats.open || 0,
        inProgress: statusStats.in_progress || 0
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalTickets: total
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ GET TICKET DETAILS (Admin/Support - Limited Access)
router.get("/:ticketId", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    // Check access permissions
    if (!canAdminAccessTicket(ticket, req.admin._id, req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to view this ticket"
      });
    }

    res.json({
      success: true,
      data: ticket
    });

  } catch (err) {
    next(err);
  }
});

// ✅ ASSIGN TICKET TO SELF (Admin/Support)
router.put("/:ticketId/assign-self", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    // Check if ticket is already assigned to someone else
    if (ticket.assignedTo?.adminId &&
      ticket.assignedTo.adminId.toString() !== req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "Ticket is already assigned to another admin"
      });
    }

    ticket.assignedTo = {
      adminId: req.admin._id,
      adminName: req.admin.name,
      assignedAt: new Date()
    };

    if (ticket.status === TICKET_STATUS.OPEN) {
      ticket.status = TICKET_STATUS.IN_PROGRESS;
    }

    await ticket.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`ticket_${ticketId}`).emit('ticket_assigned', {
        ticketId,
        adminId: req.admin._id,
        adminName: req.admin.name,
        assignedBy: 'Self-assigned'
      });
    }

    res.json({
      success: true,
      message: "Ticket assigned to you",
      data: ticket.assignedTo
    });

  } catch (err) {
    next(err);
  }
});

// ✅ UPDATE TICKET STATUS (Admin/Support - Cannot close)
router.put("/:ticketId/status", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { status, note } = req.body; r

    // Admin/Support cannot close tickets
    const allowedStatuses = [TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS,
    TICKET_STATUS.ON_HOLD, TICKET_STATUS.RESOLVED];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Admin/Support cannot close tickets"
      });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    // Check access permissions
    if (!canAdminAccessTicket(ticket, req.admin._id, req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this ticket"
      });
    }

    const oldStatus = ticket.status;
    ticket.status = status;

    // Update timestamps
    if (status === TICKET_STATUS.RESOLVED && oldStatus !== TICKET_STATUS.RESOLVED) {
      ticket.resolvedAt = new Date();
    }

    // Add internal note if provided
    if (note) {
      if (!ticket.internalNotes) ticket.internalNotes = [];
      ticket.internalNotes.push({
        adminId: req.admin._id,
        adminName: req.admin.name,
        note,
        createdAt: new Date()
      });
    }

    await ticket.save();

    // Notify user if ticket is resolved
    const io = req.app.get('io');
    if (io && status === TICKET_STATUS.RESOLVED) {
      io.to(`user_${ticket.userInfo.userId}`).emit('ticket_resolved', {
        ticketId,
        resolvedBy: req.admin.name,
        resolvedAt: new Date()
      });
    }

    res.json({
      success: true,
      message: `Ticket status updated to ${status}`,
      data: {
        oldStatus,
        newStatus: status,
        updatedAt: ticket.updatedAt
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ ADD INTERNAL NOTE (Admin/Support)
router.post("/:ticketId/note", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { note } = req.body;

    if (!note) {
      return res.status(400).json({
        success: false,
        error: "Note is required"
      });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    // Check access permissions
    if (!canAdminAccessTicket(ticket, req.admin._id, req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to add note to this ticket"
      });
    }

    if (!ticket.internalNotes) ticket.internalNotes = [];
    ticket.internalNotes.push({
      adminId: req.admin._id,
      adminName: req.admin.name,
      note,
      createdAt: new Date()
    });

    await ticket.save();

    res.json({
      success: true,
      message: "Internal note added",
      data: ticket.internalNotes[ticket.internalNotes.length - 1]
    });

  } catch (err) {
    next(err);
  }
});

// ✅ REPLY TO TICKET (Admin/Support)
router.post("/:ticketId/message", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { message, attachments = [] } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    // Check access permissions
    if (!canAdminAccessTicket(ticket, req.admin._id, req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to reply to this ticket"
      });
    }

    const newMessage = {
      senderId: req.admin._id,
      senderRole: 'admin',
      senderName: req.admin.name,
      message,
      attachments,
      createdAt: new Date()
    };

    ticket.messages.push(newMessage);

    // Update first response time if first admin response
    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date();
    }

    // Update status if was "open"
    if (ticket.status === TICKET_STATUS.OPEN) {
      ticket.status = TICKET_STATUS.IN_PROGRESS;
    }

    ticket.updatedAt = new Date();
    await ticket.save();

    // Notify user via socket
    const io = req.app.get('io');
    if (io) {
      // Notify ticket room
      io.to(`ticket_${ticketId}`).emit('ticket_message', {
        ticketId,
        message: newMessage
      });

      // Notify user specifically
      io.to(`user_${ticket.userInfo.userId}`).emit('ticket_notification', {
        ticketId,
        message: `${req.admin.name} replied to your ticket`,
        type: 'admin_reply'
      });
    }

    res.json({
      success: true,
      message: "Message added successfully",
      data: newMessage
    });

  } catch (err) {
    next(err);
  }
});

// ✅ GET BASIC ANALYTICS (Admin/Support - Limited)
router.get("/analytics/overview", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const adminId = req.admin._id;
    const { days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const [
      assignedTickets,
      resolvedTickets,
      avgResponseTime,
      avgResolutionTime,
      userSatisfaction,
      ticketsByCategory
    ] = await Promise.all([
      // Tickets assigned to this admin
      Ticket.countDocuments({
        'assignedTo.adminId': adminId,
        createdAt: { $gte: startDate }
      }),

      // Resolved tickets by this admin
      Ticket.countDocuments({
        'assignedTo.adminId': adminId,
        status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
        createdAt: { $gte: startDate }
      }),

      // Average response time
      Ticket.aggregate([
        {
          $match: {
            'assignedTo.adminId': adminId,
            firstResponseAt: { $exists: true },
            createdAt: { $gte: startDate }
          }
        },
        {
          $project: {
            responseHours: {
              $divide: [
                { $subtract: ["$firstResponseAt", "$createdAt"] },
                1000 * 60 * 60
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgResponseHours: { $avg: "$responseHours" }
          }
        }
      ]),

      // Average resolution time
      Ticket.aggregate([
        {
          $match: {
            'assignedTo.adminId': adminId,
            status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
            resolvedAt: { $exists: true },
            createdAt: { $gte: startDate }
          }
        },
        {
          $project: {
            resolutionHours: {
              $divide: [
                { $subtract: ["$resolvedAt", "$createdAt"] },
                1000 * 60 * 60
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgResolutionHours: { $avg: "$resolutionHours" }
          }
        }
      ]),

      // User satisfaction (ratings)
      Ticket.aggregate([
        {
          $match: {
            'assignedTo.adminId': adminId,
            'userRating.rating': { $exists: true },
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$userRating.rating" },
            totalRatings: { $sum: 1 }
          }
        }
      ]),

      // Tickets by category
      Ticket.aggregate([
        {
          $match: {
            'assignedTo.adminId': adminId,
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ])
    ]);

    const resolutionRate = assignedTickets > 0 ? (resolvedTickets / assignedTickets) * 100 : 0;

    res.json({
      success: true,
      data: {
        summary: {
          assignedTickets,
          resolvedTickets,
          resolutionRate: Math.round(resolutionRate * 100) / 100,
          openTickets: assignedTickets - resolvedTickets
        },
        performance: {
          avgResponseHours: avgResponseTime[0]?.avgResponseHours || 0,
          avgResolutionHours: avgResolutionTime[0]?.avgResolutionHours || 0,
          avgRating: userSatisfaction[0]?.avgRating || 0,
          totalRatings: userSatisfaction[0]?.totalRatings || 0
        },
        distribution: {
          byCategory: ticketsByCategory
        },
        period: {
          days,
          startDate,
          endDate: new Date()
        }
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ GET TICKETS ASSIGNED TO ME (Admin/Support)
router.get("/my-assigned", auth, requireRole(["admin", "support"]), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const filter = {
      'assignedTo.adminId': req.admin._id
    };

    if (status) filter.status = status;

    const tickets = await Ticket.find(filter)
      .sort({ priority: -1, updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('ticketId subject category status priority userInfo createdAt updatedAt');

    const total = await Ticket.countDocuments(filter);

    res.json({
      success: true,
      data: tickets,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalTickets: total
      }
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;