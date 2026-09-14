const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../../middlewares/auth');  
const Notification = require('../../models/Notification');

router.use(auth);
router.use(requireRole(['customer']));

// ✅ GET customer notifications
router.get('/my-notifications', async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await Notification.find({
      userId,
      userModel: req.user.constructor.modelName || 'Customer'
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      count: notifications.length,
      notifications
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// ✅ GET unread notification count
router.get('/unread-count', async (req, res) => {
  try {
    const userId = req.user._id;
    const count = await Notification.countDocuments({
      userId,
      userModel: req.user.constructor.modelName || 'Customer',
      read: false
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to count unread notifications'
    });
  }
});

// ✅ MARK notification as read
router.patch('/:notificationId/read', async (req, res) => {
  try {
    const userId = req.user._id;
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.notificationId,
        userId
      },
      {
        read: true,
        readAt: new Date()
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// ✅ MARK ALL notifications as read
router.patch('/mark-all-read', async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.updateMany(
      {
        userId,
        read: false
      },
      {
        read: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark all as read'
    });
  }
});

module.exports = router;
