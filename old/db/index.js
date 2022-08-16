const mongoose = require("mongoose");
const Listing = require("./Listing.js");

const connectToMongoDb = async function() {
  await mongoose.connect(
    "mongodb+srv://alexbrailko:Alex10749%23@cluster0.gipwn.mongodb.net/?retryWrites=true&w=majority",
    { useNewUrlParser: true }
  );
  console.log("connected to mongodb");
}

const saveToDb = async function(listings = []) {
  for (var i = 0; i < listings.length; i++) {
    const listingModel = new Listing(listings[i]);
    await listingModel.save();
  }
  console.log('Listings saved');
}

module.exports = { connectToMongoDb, saveToDb };