const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema({
  url: String,
  datePosted: Date,
  title: String,
  listingPrice: String,
  beds: Number,
  baths: Number,
  address: String,
  serviceCharge: String,
  groundRent: String,
  pictures: [{ small: String, medium: String, large: String }],
  active: Boolean
});

const Listing = mongoose.model("Listing", listingSchema);

module.exports = Listing;