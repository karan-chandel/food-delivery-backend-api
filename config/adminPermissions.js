// config/adminPermissions.js
const PERMISSION_PRESETS = {
  super_admin: {
    user_management: { view: true, create: true, edit: true, delete: true, verify: true },
    restaurant_management: { view: true, create: true, edit: true, delete: true, verify: true },
    rider_management: { view: true, create: true, edit: true, delete: true, verify: true },
    order_management: { view: true, update: true, cancel: true, refund: true },
    content_management: { view: true, create: true, edit: true, delete: true },
    analytics: { view: true, export: true }
  },
  admin: {
    user_management: { view: true, create: true, edit: true, delete: false, verify: true },
    restaurant_management: { view: true, create: true, edit: true, delete: false, verify: true },
    rider_management: { view: true, create: true, edit: true, delete: false, verify: true },
    order_management: { view: true, update: true, cancel: true, refund: false },
    content_management: { view: true, create: true, edit: true, delete: true },
    analytics: { view: true, export: true }
  },
  moderator: {
    user_management: { view: true, create: false, edit: true, delete: false, verify: true },
    restaurant_management: { view: true, create: false, edit: true, delete: false, verify: true },
    rider_management: { view: true, create: false, edit: true, delete: false, verify: true },
    order_management: { view: true, update: true, cancel: true, refund: false },
    content_management: { view: true, create: true, edit: true, delete: true },
    analytics: { view: true, export: false }
  },
  support: {
    user_management: { view: true, create: false, edit: true, delete: false, verify: false },
    restaurant_management: { view: true, create: false, edit: false, delete: false, verify: false },
    rider_management: { view: true, create: false, edit: false, delete: false, verify: false },
    order_management: { view: true, update: true, cancel: true, refund: false },
    content_management: { view: true, create: false, edit: false, delete: false },
    analytics: { view: false, export: false }
  }
};

module.exports = { PERMISSION_PRESETS };