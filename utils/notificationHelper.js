// utils/notificationHelper.js
const Notification = require('../models/Notification');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const RestaurantUser = require('../models/RestaurantUser');
const Admin = require('../models/Admin');

async function createNotification(data) {
    try {
        const { userId, title, message, type, priority = 'medium' } = data;
        const notificationPayload = data.data || data.notificationData || {};
        
        // User model detect karo
        let userModel = 'User';
        
        const customer = await Customer.findById(userId);
        if (customer) {
            userModel = 'Customer';
        } else {
            const rider = await Rider.findById(userId);
            if (rider) {
                userModel = 'Rider';
            } else {
                const restaurantUser = await RestaurantUser.findById(userId);
                if (restaurantUser) {
                    userModel = 'RestaurantUser';
                } else {
                    const admin = await Admin.findById(userId);
                    if (admin) {
                        userModel = 'Admin';
                    }
                }
            } 
        }
        
        // Notification create karo
        const notification = new Notification({
            userId,
            userModel,
            title,
            message,
            type,
            data: notificationPayload,
            priority,
            read: false
        });
        
        await notification.save();
        return notification;
    } catch (error) {
        console.error('Notification creation error:', error);
        return null;
    }
}

async function createRestaurantNotifications(restaurantId, notificationData) {
    try {
        const restaurantUsers = await RestaurantUser.find({ 
            restaurantId: restaurantId,
            isActive: true 
        });
        
        const notifications = [];
        for (const user of restaurantUsers) {
            const notification = await createNotification({
                userId: user._id,
                userModel: 'RestaurantUser', // DIRECT SET KARO 
                ...notificationData
            });
            if (notification) notifications.push(notification);
        }
        return notifications;
    } catch (error) {
        console.error('Restaurant notifications error:', error);
        return [];
    }
}

module.exports = { createNotification, createRestaurantNotifications };