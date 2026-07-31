// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  return distance;
}

// Calculate delivery earnings based on distance and order amount
function calculateDeliveryEarnings(distance, orderAmount) {
  const baseFee = 15; // Base delivery fee
  const distanceRate = 5; // ₹5 per km
  const orderCommission = 0.1; // 10% of order amount
  
  const distanceEarnings = distance * distanceRate;
  const commissionEarnings = orderAmount * orderCommission;
  
  return Math.round(baseFee + distanceEarnings + commissionEarnings);
}

module.exports = {
  calculateDistance,
  calculateDeliveryEarnings
};