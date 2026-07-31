// utils/ticketHelper.js
const Ticket = require('../models/Ticket');
const mongoose = require('mongoose');

/**
 * Helper function to find tickets by various identifiers
 */
const findTicket = async (identifier) => {
  try {
    // If identifier is empty/null/undefined
    if (!identifier) {
      return null;
    }
    
    const identifierStr = identifier.toString();
    
    // Try exact match first
    let ticket = await Ticket.findOne({ ticketId: identifierStr });
    if (ticket) return ticket;
    
    // Try case-insensitive match
    ticket = await Ticket.findOne({ 
      ticketId: new RegExp(`^${identifierStr}$`, 'i') 
    });
    if (ticket) return ticket;
    
    // Try as MongoDB ObjectId
    if (mongoose.Types.ObjectId.isValid(identifierStr)) {
      return await Ticket.findById(identifierStr);
    }
    
    return null;
  } catch (error) {
    console.error('Error in findTicket helper:', error);
    return null;
  }
};

module.exports = { findTicket };