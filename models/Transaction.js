const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
    tokenId: String,
    senderId: String,
    receiverId: String,
    amount: Number,
    power: Number,
    date: { type: Date, default: Date.now } ,
    price: Number,
    type: String
    
});

const Transaction = mongoose.model("Transaction", transactionSchema);
module.exports = Transaction;
