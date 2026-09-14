const express = require("express");
const router = express.Router();

router.use("/auth", require("./auth"));
router.use("/profile", require("./profile"));
router.use("/menu", require("./menu"));
router.use("/orders", require("./orders"));
router.use("/coupons", require("./coupons"));

module.exports = router;
