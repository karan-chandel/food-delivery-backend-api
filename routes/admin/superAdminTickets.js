// routes/super-admin/tickets.js
const express = require("express");
const router = express.Router();
const Ticket = require("../../models/Ticket");
const Admin = require("../../models/Admin");
const { auth, requireRole } = require("../../middlewares/auth");
//const { findTicket } = require("../utils/ticketHelper");
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

// ============================ SUPER ADMIN TICKET ROUTES ============================

// ✅ GET ALL TICKETS (Super Admin - Complete Access)
router.get("/", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { 
      status, 
      priority, 
      category, 
      role,
      assignedTo,
      search,
      startDate,
      endDate,
      page = 1, 
      limit = 20 
    } = req.query;

    const skip = (page - 1) * limit;
    
    const filter = {};
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (role) filter['userInfo.role'] = role;
    
    if (assignedTo === 'unassigned') {
      filter['assignedTo.adminId'] = { $exists: false };
    } else if (assignedTo) {
      filter['assignedTo.adminId'] = assignedTo;
    }
    
    // Date filtering
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    if (search) {
      filter.$or = [
        { ticketId: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'userInfo.name': { $regex: search, $options: 'i' } },
        { 'userInfo.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const tickets = await Ticket.find(filter)
      .populate('assignedTo.adminId', 'name email')
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('ticketId subject category status priority userInfo assignedTo createdAt updatedAt');
    
    const total = await Ticket.countDocuments(filter);
    
    // Get stats for the filter
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
        byStatus: statusStats
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

// ✅ GET TICKET DETAILS (Super Admin - Any Ticket) - SIMPLIFIED & FIXED
// ✅ GET TICKET DETAILS (Super Admin - Any Ticket) - FIXED VERSION
router.get("/:ticketId", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    
    // Validate input
    if (!ticketId || ticketId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Ticket ID is required"
      });
    }
    
    console.log(`Looking for ticket with ID: "${ticketId}"`);
    
    // Use direct query instead of findTicket helper
    const ticket = await Ticket.findOne({ ticketId: ticketId });
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: `Ticket "${ticketId}" not found`
      });
    }
    
    // Populate the admin references
    const populatedTicket = await Ticket.findById(ticket._id)
      .populate('assignedTo.adminId', 'name email')
      .populate('closedBy', 'name email');
    
    res.json({
      success: true,
      data: populatedTicket
    });
    
  } catch (err) {
    console.error('Error in GET /tickets/:ticketId:', err);
    next(err);
  }
});
// ✅ UPDATE TICKET PRIORITY (Super Admin Only)
router.put("/:ticketId/priority", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { priority } = req.body;
    
    if (!Object.values(TICKET_PRIORITY).includes(priority)) {
      return res.status(400).json({
        success: false,
        error: "Invalid priority"
      });
    }
    
    const ticket = await Ticket.findOneAndUpdate(
      { ticketId },
      { priority },
      { new: true }
    );
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }
    
    res.json({
      success: true,
      message: "Ticket priority updated",
      data: ticket
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ ASSIGN TICKET TO ANY ADMIN (Super Admin Only)
router.put("/:ticketId/assign", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { adminId } = req.body;
    
    if (!adminId) {
      return res.status(400).json({
        success: false,
        error: "adminId is required"
      });
    }
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }
    
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }
    
    ticket.assignedTo = {
      adminId: admin._id,
      adminName: admin.name,
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
        adminId: admin._id,
        adminName: admin.name,
        assignedBy: req.admin.name
      });
    }
    
    res.json({
      success: true,
      message: `Ticket assigned to ${admin.name}`,
      data: ticket.assignedTo
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ BULK ASSIGN TICKETS (Super Admin Only)
router.post("/bulk-assign", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketIds, adminId } = req.body;
    
    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "ticketIds array is required"
      });
    }
    
    if (!adminId) {
      return res.status(400).json({
        success: false,
        error: "adminId is required"
      });
    }
    
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }
    
    const result = await Ticket.updateMany(
      { ticketId: { $in: ticketIds } },
      { 
        $set: {
          'assignedTo.adminId': admin._id,
          'assignedTo.adminName': admin.name,
          'assignedTo.assignedAt': new Date(),
          status: TICKET_STATUS.IN_PROGRESS
        }
      }
    );
    
    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      ticketIds.forEach(ticketId => {
        io.to(`ticket_${ticketId}`).emit('ticket_assigned', {
          ticketId,
          adminId: admin._id,
          adminName: admin.name,
          assignedBy: req.admin.name
        });
      });
    }
    
    res.json({
      success: true,
      message: `${result.modifiedCount} tickets assigned to ${admin.name}`,
      modifiedCount: result.modifiedCount
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ BULK UPDATE TICKET STATUS (Super Admin Only)
router.post("/bulk-status", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketIds, status, note } = req.body;
    
    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "ticketIds array is required"
      });
    }
    
    if (!Object.values(TICKET_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status"
      });
    }
    
    const updateData = { status };
    
    // Update timestamps based on status
    if (status === TICKET_STATUS.RESOLVED) {
      updateData.resolvedAt = new Date();
    } else if (status === TICKET_STATUS.CLOSED) {
      updateData.closedAt = new Date();
      updateData.closedBy = req.admin._id;
    }
    
    const result = await Ticket.updateMany(
      { ticketId: { $in: ticketIds } },
      { $set: updateData }
    );
    
    // Add internal note if provided
    if (note) {
      await Promise.all(
        ticketIds.map(async (ticketId) => {
          const ticket = await Ticket.findOne({ ticketId });
          if (ticket) {
            ticket.internalNotes.push({
              adminId: req.admin._id,
              adminName: req.admin.name,
              note: `Bulk action: ${note}`,
              createdAt: new Date()
            });
            await ticket.save();
          }
        })
      );
    }
    
    res.json({
      success: true,
      message: `${result.modifiedCount} tickets updated to ${status}`,
      modifiedCount: result.modifiedCount
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ DELETE TICKET (Super Admin Only - Archival)
router.delete("/:ticketId", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }
    
    // Instead of deleting, mark as archived
    ticket.isArchived = true;
    ticket.archivedAt = new Date();
    ticket.archivedBy = req.admin._id;
    ticket.archiveReason = reason || "Archived by super admin";
    
    await ticket.save();
    
    res.json({
      success: true,
      message: "Ticket archived successfully",
      data: {
        ticketId: ticket.ticketId,
        archivedAt: ticket.archivedAt
      }
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ GET TICKET ANALYTICS (Advanced - Super Admin Only)
router.get("/analytics/overview", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { days = 30, startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    } else {
      const start = new Date();
      start.setDate(start.getDate() - parseInt(days));
      dateFilter.createdAt = { $gte: start };
    }
    
    const [
      dailyTickets,
      categoryDistribution,
      statusDistribution,
      resolutionStats,
      slaCompliance,
      ratingStats,
      ticketsByAdmin,
      escalationStats
    ] = await Promise.all([
      // Daily ticket counts
      Ticket.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
        { $limit: 30 }
      ]),
      
      // Category distribution
      Ticket.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Status distribution
      Ticket.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      
      // Average resolution time
      Ticket.aggregate([
        {
          $match: {
            status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
            resolvedAt: { $exists: true }
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
            avgResolutionHours: { $avg: "$resolutionHours" },
            minResolutionHours: { $min: "$resolutionHours" },
            maxResolutionHours: { $max: "$resolutionHours" },
            medianResolutionHours: { $median: "$resolutionHours" }
          }
        }
      ]),
      
      // SLA compliance
      Ticket.aggregate([
        {
          $match: {
            status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
            resolvedAt: { $exists: true },
            resolutionDueAt: { $exists: true }
          }
        },
        {
          $project: {
            metSLA: {
              $cond: {
                if: { $lte: ["$resolvedAt", "$resolutionDueAt"] },
                then: true,
                else: false
              }
            }
          }
        },
        {
          $group: {
            _id: "$metSLA",
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Rating stats
      Ticket.aggregate([
        { $match: { 'userRating.rating': { $exists: true } } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$userRating.rating" },
            totalRatings: { $sum: 1 },
            ratingDistribution: {
              $push: "$userRating.rating"
            }
          }
        }
      ]),
      
      // Tickets by admin performance
      Ticket.aggregate([
        {
          $match: {
            'assignedTo.adminId': { $exists: true },
            ...dateFilter
          }
        },
        {
          $group: {
            _id: "$assignedTo.adminId",
            adminName: { $first: "$assignedTo.adminName" },
            totalAssigned: { $sum: 1 },
            resolvedCount: {
              $sum: {
                $cond: [
                  { $in: ["$status", [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED]] },
                  1,
                  0
                ]
              }
            },
            avgRating: { $avg: "$userRating.rating" }
          }
        },
        { $sort: { totalAssigned: -1 } }
      ]),
      
      // Escalation stats
      Ticket.aggregate([
        { $match: { isEscalated: true } },
        {
          $group: {
            _id: "$escalationReason",
            count: { $sum: 1 }
          }
        }
      ])
    ]);
    
    // Calculate SLA metrics
    let slaCompliant = 0;
    let slaViolated = 0;
    
    slaCompliance.forEach(item => {
      if (item._id === true) slaCompliant = item.count;
      if (item._id === false) slaViolated = item.count;
    });
    
    const totalResolved = slaCompliant + slaViolated;
    const slaComplianceRate = totalResolved > 0 ? (slaCompliant / totalResolved) * 100 : 0;
    
    // Calculate rating distribution
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (ratingStats[0] && ratingStats[0].ratingDistribution) {
      ratingStats[0].ratingDistribution.forEach(rating => {
        const rounded = Math.round(rating);
        if (rounded >= 1 && rounded <= 5) {
          ratingDistribution[rounded]++;
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        dailyTickets,
        categoryDistribution,
        statusDistribution,
        resolutionStats: resolutionStats[0] || {
          avgResolutionHours: 0,
          minResolutionHours: 0,
          maxResolutionHours: 0,
          medianResolutionHours: 0
        },
        sla: {
          compliant: slaCompliant,
          violated: slaViolated,
          complianceRate: Math.round(slaComplianceRate * 100) / 100,
          totalResolved
        },
        ratings: ratingStats[0] || {
          avgRating: 0,
          totalRatings: 0
        },
        ratingDistribution,
        adminPerformance: ticketsByAdmin,
        escalations: escalationStats,
        summary: {
          totalTickets: await Ticket.countDocuments(dateFilter),
          openTickets: await Ticket.countDocuments({ ...dateFilter, status: TICKET_STATUS.OPEN }),
          highPriorityTickets: await Ticket.countDocuments({ ...dateFilter, priority: TICKET_PRIORITY.HIGH }),
          escalatedTickets: await Ticket.countDocuments({ ...dateFilter, isEscalated: true })
        }
      }
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ EXPORT TICKETS (Super Admin Only)
router.get("/export/csv", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { 
      status, 
      priority, 
      category, 
      startDate,
      endDate 
    } = req.query;
    
    const filter = {};
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .select('ticketId subject category subCategory status priority userInfo.name userInfo.role userInfo.phone assignedTo.adminName createdAt updatedAt resolvedAt closedAt firstResponseAt resolutionDueAt userRating.rating');
    
    // Convert to CSV format
    const csvData = [
      [
        'Ticket ID',
        'Subject',
        'Category',
        'Sub-Category',
        'Status',
        'Priority',
        'Customer Name',
        'Customer Role',
        'Customer Phone',
        'Assigned To',
        'Created At',
        'Updated At',
        'Resolved At',
        'Closed At',
        'First Response At',
        'Resolution Due At',
        'Rating'
      ].join(',')
    ];
    
    tickets.forEach(ticket => {
      csvData.push([
        ticket.ticketId,
        `"${ticket.subject.replace(/"/g, '""')}"`,
        ticket.category,
        ticket.subCategory || '',
        ticket.status,
        ticket.priority,
        ticket.userInfo.name,
        ticket.userInfo.role,
        ticket.userInfo.phone,
        ticket.assignedTo?.adminName || 'Unassigned',
        ticket.createdAt.toISOString(),
        ticket.updatedAt.toISOString(),
        ticket.resolvedAt ? ticket.resolvedAt.toISOString() : '',
        ticket.closedAt ? ticket.closedAt.toISOString() : '',
        ticket.firstResponseAt ? ticket.firstResponseAt.toISOString() : '',
        ticket.resolutionDueAt ? ticket.resolutionDueAt.toISOString() : '',
        ticket.userRating?.rating || ''
      ].join(','));
    });
    
    const csv = csvData.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${Date.now()}.csv`);
    res.send(csv);
    
  } catch (err) {
    next(err);
  }
});

// ✅ GET TICKET AUDIT LOG (Super Admin Only)
router.get("/:ticketId/audit-log", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    
    const ticket = await Ticket.findOne({ ticketId }).select('auditLog');
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }
    
    res.json({
      success: true,
      data: ticket.auditLog || []
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ ESCALATE TICKET (Super Admin Only)
router.post("/:ticketId/escalate", auth, requireRole(["super_admin"]), async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { reason, note } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Escalation reason is required"
      });
    }
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }
    
    ticket.isEscalated = true;
    ticket.escalationReason = reason;
    ticket.escalatedAt = new Date();
    ticket.escalatedBy = req.admin._id;
    
    if (note) {
      ticket.internalNotes.push({
        adminId: req.admin._id,
        adminName: req.admin.name,
        note: `Escalation: ${note}`,
        createdAt: new Date()
      });
    }
    
    // Update audit log
    if (!ticket.auditLog) ticket.auditLog = [];
    ticket.auditLog.push({
      action: 'escalated',
      adminId: req.admin._id,
      adminName: req.admin.name,
      details: { reason },
      timestamp: new Date()
    });
    
    await ticket.save();
    
    res.json({
      success: true,
      message: "Ticket escalated successfully",
      data: {
        isEscalated: true,
        escalationReason: reason,
        escalatedAt: ticket.escalatedAt
      }
    });
    
  } catch (err) {
    next(err);
  }
});

module.exports = router;