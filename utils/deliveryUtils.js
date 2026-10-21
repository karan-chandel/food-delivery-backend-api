// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 1.0;
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return parseFloat(distance.toFixed(2));
}

// Distance slab base fare (Official Zewito Payout Specification)
function getDistanceBaseFare(distanceKm) {
  const km = Number(distanceKm) || 1;
  if (km <= 2) return 25;
  if (km <= 3) return 30;
  if (km <= 4) return 35;
  if (km <= 5) return 42;
  if (km <= 6) return 50;
  if (km <= 7) return 58;
  if (km <= 8) return 66;
  if (km <= 9) return 75;
  if (km <= 10) return 85;

  // 10 KM+: ₹85 + ₹9 per additional KM
  const extraKm = Math.ceil(km - 10);
  return 85 + extraKm * 9;
}

// Peak hour incentive: 12-2 PM (+₹5), 7-10 PM (+₹10)
function getPeakHourBonus(date = new Date()) {
  const hour = new Date(date).getHours();
  if (hour >= 12 && hour < 14) return 5;
  if (hour >= 19 && hour < 22) return 10;
  return 0;
}

// Long distance bonus
function getLongDistanceBonus(distanceKm) {
  const km = Number(distanceKm) || 0;
  if (km > 15) return 30;
  if (km >= 10) return 20;
  if (km >= 8) return 10;
  return 0;
}

// Calculate delivery earnings matching zewito-logistics-service specification
function calculateDeliveryEarnings(distance, orderAmount = 0) {
  const distanceKm = Number(distance) || 1;
  const baseFare = getDistanceBaseFare(distanceKm);
  const peakBonus = getPeakHourBonus();
  const longDistanceBonus = getLongDistanceBonus(distanceKm);

  return Math.round(baseFare + peakBonus + longDistanceBonus);
}

module.exports = {
  calculateDistance,
  calculateDeliveryEarnings,
  getDistanceBaseFare,
  getPeakHourBonus,
  getLongDistanceBonus,
};