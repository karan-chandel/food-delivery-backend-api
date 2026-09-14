// routes/tickets.js
const express = require("express");
const router = express.Router();
const Ticket = require("../../models/Ticket");
const { auth, requireRole } = require("../../middlewares/auth");
const { upload, handleUploadErrors } = require("../../middlewares/upload");
const { getUserInfoForTicket, getOrderInfoForTicket } = require("../../utils/ticketUserHelper");

// ✅ HELPER: Check if user owns the ticket
// const canUserAccessTicket = (ticket, userId) => {
//   return ticket.userInfo.userId.toString() === userId.toString();
// };
// ✅ HELPER: Check if user owns the ticket (SAFE VERSION)
const canUserAccessTicket = (ticket, userId) => {
  try {
    // Deep check for undefined/null
    if (!ticket || !ticket.userInfo) {
      console.log('Ticket or userInfo is missing:', { 
        hasTicket: !!ticket, 
        hasUserInfo: !!ticket?.userInfo 
      });
      return false;
    }
    
    // Check if userInfo has userId
    if (!ticket.userInfo.userId) {
      console.log('userInfo.userId is missing:', ticket.userInfo);
      return false;
    }
    
    // Convert both to string for comparison
    const ticketUserId = ticket.userInfo.userId.toString();
    const requestUserId = userId?.toString();
    
    return ticketUserId === requestUserId;
  } catch (error) {
    console.error('Error in canUserAccessTicket:', error);
    console.error('Ticket data:', {
      ticketId: ticket?.ticketId,
      userInfo: ticket?.userInfo,
      userIdType: typeof ticket?.userInfo?.userId
    });
    return false;
  }
};
// ============================ USER TICKET ROUTES ============================

// ✅ CREATE TICKET (Customer/Rider/Restaurant)
router.post("/", auth, async (req, res, next) => {
  try {
    const { subject, description, category, subCategory, orderId } = req.body;
    
    // Validation
    if (!subject || !description || !category) {
      return res.status(400).json({
        success: false,
        error: 'Subject, description, and category are required'
      });
    }
    
    // Get user info for ticket (DENORMALIZED)
    const userInfo = await getUserInfoForTicket(req.user._id);
    if (!userInfo) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Get order info if provided
    let orderReference = null;
    if (orderId) {
      orderReference = await getOrderInfoForTicket(orderId);
    }
    
    // Calculate SLA (Service Level Agreement)
    const resolutionDueAt = new Date();
    resolutionDueAt.setHours(resolutionDueAt.getHours() + 48);
    
    // Determine priority based on category
    let priority = 'medium';
    if (category === 'payment_problem' || category === 'emergency') {
      priority = 'high';
    } else if (category === 'general_inquiry') {
      priority = 'low';
    }
    
    // Create ticket
     const ticketId = "TCKT-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const ticket = await Ticket.create({
     ticketId,
      subject,
      description,
      category,
      subCategory,
      userInfo,
      orderReference,
      priority,
      resolutionDueAt,
      messages: [{
        senderId: req.user._id,
        senderRole: req.user.role,
        senderName: req.user.name,
        message: description,
        createdAt: new Date()
      }]
    });
    
    // Notify admins via socket
    const io = req.app.get('io');
    if (io) {
      io.to('admin_support_room').emit('new_ticket', {
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        category: ticket.category,
        user: {
          name: userInfo.name,
          role: userInfo.role,
          phone: userInfo.phone
        },
        priority: ticket.priority,
        createdAt: ticket.createdAt
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: {
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt
      }
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ GET USER'S TICKETS
router.get("/my-tickets", auth, async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = {
      'userInfo.userId': req.user._id
    };
    
    if (status) filter.status = status;
    if (category) filter.category = category;
    
    const tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('ticketId subject category status priority createdAt updatedAt assignedTo.adminName');
    
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

// ✅ GET SINGLE TICKET (User's own only) okokoko
router.get("/:ticketId", auth, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }
    
    // Check if user owns this ticket
    if (!canUserAccessTicket(ticket, req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view this ticket'
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
// ✅ CLOSE TICKET (User)
router.put(
  "/:ticketId/close",
  auth,
  requireRole(["customer"]),
  async (req, res) => {
    try {
      const ticket = await Ticket.findOne({
        ticketId: req.params.ticketId,
        "userInfo.userId": req.user._id
      });

      if (!ticket) {
        return res.status(404).json({
          success: false,
          error: "Ticket not found"
        });
      }

      if (ticket.status === "closed") {
        return res.status(400).json({
          success: false,
          error: "Ticket already closed"
        });
      }

      ticket.status = "closed";
      ticket.closedAt = new Date();
      ticket.closedBy = {
        id: req.user._id,
        role: "customer"
      };

      if (!ticket.auditLog) {
  ticket.auditLog = [];
}

ticket.auditLog.push({
  action: "TICKET_CLOSED_BY_CUSTOMER",
  details: {
    userId: req.user._id,
    role: "customer",
    name: req.user.name || "Customer"
  }
});

      await ticket.save();

      res.json({
        success: true,
        message: "Ticket closed successfully"
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);


// ✅ ADD MESSAGE TO TICKET WITH ATTACHMENTS
router.post( "/:ticketId/message",
  auth,
  upload.array("attachments", 5),   
  handleUploadErrors,               
  async (req, res, next) => {
    try {
      const { ticketId } = req.params;
      const { message } = req.body;

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

      if (!canUserAccessTicket(ticket, req.user._id)) {
        return res.status(403).json({
          success: false,
          error: "Not authorized"
        });
      }

      delete req.body.attachments;
 ticket.attachments = undefined;
      
      const attachments = (req.files || []).map(file => ({
        fileName: file.originalname,
        fileUrl: `/uploads/menu-items/${file.filename}`,
        fileType: file.mimetype,
        fileSize: file.size
      }));

      const senderName =
        req.user.role === "admin" || req.user.role === "support"
          ? req.user.name
          : ticket.userInfo.name;

      const newMessage = {
        senderId: req.user._id,
        senderRole: req.user.role,
        senderName,
        message,
        attachments
      };

      ticket.messages.push(newMessage);

      if (ticket.status === "closed" || ticket.status === "resolved") {
        ticket.status = "open";
      }

      await ticket.save();

      res.json({
        success: true,
        message: "Message added successfully",
        data: newMessage
      });

    } catch (err) {
      next(err);
    }
  }
);
// ✅ RATE TICKET
router.post("/:ticketId/rate", auth, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { rating, feedback } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Valid rating (1-5) is required'
      });
    }
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }
    
    // Check if user owns this ticket
    if (!canUserAccessTicket(ticket, req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to rate this ticket'
      });
    }
    
    // Check if ticket is resolved/closed
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        error: 'Can only rate resolved or closed tickets'
      });
    }
    
    // Check if already rated
    if (ticket.userRating && ticket.userRating.rating) {
      return res.status(400).json({
        success: false,
        error: 'Ticket already rated'
      });
    }
    
    ticket.userRating = {
      rating,
      feedback,
      ratedAt: new Date()
    };
    
    await ticket.save();
    
    // Notify admin about rating okokoko
    const io = req.app.get('io');
    if (io && ticket.assignedTo?.adminId) {
      io.to(`admin_${ticket.assignedTo.adminId}`).emit('ticket_rated', {
        ticketId,
        rating,
        feedback
      });
    }
    
    res.json({
      success: true,
      message: 'Thank you for your rating!',
      data: ticket.userRating
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ MARK TICKET AS RESOLVED (User side)
router.post("/:ticketId/resolve", auth, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }
    
    // Check if user owns this ticket
    if (!canUserAccessTicket(ticket, req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to resolve this ticket'
      });
    }
    
    // Only user can mark as resolved if it's in progress
    if (ticket.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        error: 'Ticket must be in progress to mark as resolved'
      });
    }
    
    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    ticket.resolvedByUser = true;
    
    await ticket.save();
    
    // Notify admin
    const io = req.app.get('io');
    if (io && ticket.assignedTo?.adminId) {
      io.to(`admin_${ticket.assignedTo.adminId}`).emit('ticket_user_resolved', {
        ticketId,
        userName: req.user.name,
        resolvedAt: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Ticket marked as resolved',
      data: {
        status: ticket.status,
        resolvedAt: ticket.resolvedAt
      }
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ REOPEN TICKET
router.post("/:ticketId/reopen", auth, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;
    
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }
    
    // Check if user owns this ticket
    if (!canUserAccessTicket(ticket, req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to reopen this ticket'
      });
    }
    
    // Check if ticket can be reopened
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        error: 'Only resolved or closed tickets can be reopened'
      });
    }
    
    // Check time limit (within 7 days)
    const daysSinceResolved = (new Date() - ticket.resolvedAt) / (1000 * 60 * 60 * 24);
    if (daysSinceResolved > 7) {
      return res.status(400).json({
        success: false,
        error: 'Tickets can only be reopened within 7 days of resolution'
      });
    }
    
    ticket.status = 'open';
    ticket.reopenedAt = new Date();
    ticket.reopenedBy = req.user._id;
    ticket.reopenReason = reason;
    
    // Add to messages
    ticket.messages.push({
      senderId: req.user._id,
      senderRole: req.user.role,
      senderName: req.user.name,
      message: `Ticket reopened. Reason: ${reason}`,
      createdAt: new Date()
    });
    
    await ticket.save();
    
    // Notify admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin_support_room').emit('ticket_reopened', {
        ticketId,
        userName: req.user.name,
        reason,
        reopenedAt: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Ticket reopened successfully',
      data: {
        status: ticket.status,
        reopenedAt: ticket.reopenedAt
      }
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ GET TICKET CATEGORIES
router.get("/categories/list", auth, async (req, res, next) => {
  try {
    const categories = [
      {
        id: 'order_issue',
        name: 'Order Issue',
        subCategories: [
          'order_not_received',
          'wrong_order',
          'late_delivery',
          'missing_items',
          'quality_issue'
        ]
      },
      {
        id: 'payment_problem',
        name: 'Payment Problem',
        subCategories: [
          'payment_failed',
          'refund_request',
          'double_charge',
          'payment_not_reflected'
        ]
      },
      {
        id: 'account_issue',
        name: 'Account Issue',
        subCategories: [
          'login_problem',
          'verification_issue',
          'profile_update',
          'password_reset'
        ]
      },
      {
        id: 'technical_issue',
        name: 'Technical Issue',
        subCategories: [
          'app_not_working',
          'website_error',
          'payment_gateway',
          'notification_issue'
        ]
      },
      {
        id: 'general_inquiry',
        name: 'General Inquiry',
        subCategories: [
          'menu_inquiry',
          'delivery_areas',
          'business_hours',
          'partnership'
        ]
      },
      {
        id: 'feedback',
        name: 'Feedback/Suggestion',
        subCategories: [
          'service_feedback',
          'product_suggestion',
          'app_improvement',
          'restaurant_feedback'
        ]
      }
    ];
    
    res.json({
      success: true,
      data: categories
    });
    
  } catch (err) {
    next(err);
  }
});

// ✅ GET TICKET STATS FOR USER
router.get("/stats/overview", auth, async (req, res, next) => {
  try {
    const userId = req.user._id;
    
    const [
      totalTickets,
      openTickets,
      resolvedTickets,
      recentTickets
    ] = await Promise.all([
      Ticket.countDocuments({ 'userInfo.userId': userId }),
      Ticket.countDocuments({ 
        'userInfo.userId': userId,
        status: { $in: ['open', 'in_progress', 'on_hold'] }
      }),
      Ticket.countDocuments({ 
        'userInfo.userId': userId,
        status: { $in: ['resolved', 'closed'] }
      }),
      Ticket.find({ 'userInfo.userId': userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('ticketId subject status priority createdAt')
    ]);
    
    res.json({
      success: true,
      data: {
        total: totalTickets,
        open: openTickets,
        resolved: resolvedTickets,
        resolutionRate: totalTickets > 0 ? (resolvedTickets / totalTickets * 100).toFixed(2) : 0,
        recentTickets: recentTickets.map(ticket => ({
          ticketId: ticket.ticketId,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt
        }))
      }
    });
    
  } catch (err) {
    next(err);
  }
});

module.exports = router;