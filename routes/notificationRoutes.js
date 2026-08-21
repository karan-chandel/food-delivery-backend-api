const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');  
const Notification = require('../models/Notification');

// ✅ GET user notifications
router.get('/my-notifications', auth, async (req, res) => {
    try {
        const userId = req.admin ? req.admin._id : req.user._id;
        const userModel = req.admin ? 'Admin' : req.user.constructor.modelName;

        const notifications = await Notification.find({
            userId,
            userModel
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
router.get('/unread-count', auth, async (req, res) => {
    try {
        const userId = req.admin ? req.admin._id : req.user._id;
        const userModel = req.admin ? 'Admin' : req.user.constructor.modelName;

        const count = await Notification.countDocuments({
            userId,
            userModel,
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
router.patch('/:notificationId/read', auth, async (req, res) => {
    try {
        const userId = req.admin ? req.admin._id : req.user._id;
        const userModel = req.admin ? 'Admin' : req.user.constructor.modelName;

        const notification = await Notification.findOneAndUpdate(
            {
                _id: req.params.notificationId,
                userId,
                userModel
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
router.post('/mark-all-read', auth, async (req, res) => {
    try {
        const userId = req.admin ? req.admin._id : req.user._id;
        const userModel = req.admin ? 'Admin' : req.user.constructor.modelName;

        await Notification.updateMany(
            {
                userId,
                userModel,
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
            message: 'Failed to mark all notifications as read'
        });
    }
});

// ✅ DELETE notification
router.delete('/:notificationId', auth, async (req, res) => {
    try {
        const userId = req.admin ? req.admin._id : req.user._id;
        const userModel = req.admin ? 'Admin' : req.user.constructor.modelName;

        const notification = await Notification.findOneAndDelete({
            _id: req.params.notificationId,
            userId,
            userModel
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification'
        });
    }
});

module.exports = router;