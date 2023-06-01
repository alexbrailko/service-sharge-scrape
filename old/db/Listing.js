const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema({
  url: String,
  type: String,
  datePosted: Date,
  title: String,
  listingPrice: String,
  beds: Number,
  baths: Number,
  address: String,
  postCode: String,
  serviceCharge: String,
  groundRent: String,
  pictures: [{ small: String, medium: String, large: String }],
});

const Listing = mongoose.model("Listing", listingSchema);

module.exports = Listing;