require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 3000;

// Middleware
const app = express();
app.use(express.json()); // To parse JSON body
app.use(cors());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_SECRET_KEY, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // all collection
    const database = client.db("study-nest");
    const usersCollection = database.collection("users");

    // POST /users - insert a user
    app.post("/users", async (req, res) => {
      const user = req.body;
      console.log(user)

      // if (!user.username || !user.email) {
      //   return res.status(400).json({ message: "Name and email required" });
      // }

      try {
        const result = await usersCollection.insertOne(user);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (error) {
        res.status(500).json({ message: "Failed to insert user", error });
      }
    });

    
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Root Route
app.get("/", (req, res) => {
  res.send("Education Server is running!");
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
