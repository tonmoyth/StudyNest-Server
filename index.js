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
    const teachersCollection = database.collection("teachers");

    // create api for user info insert 
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

    // update user last login
    app.patch('/users/last-login', async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      try {
        const filter = { email: email };
        const update = {
          $set: {
            last_login: new Date()
          }
        };

        const result = await usersCollection.updateOne(filter, update);

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'Last login updated' });
      } catch (error) {
        res.status(500).json({ message: 'Something went wrong', error });
      }
    });

    // create post api for insert teacher
    app.post('/teacher', async (req, res) => {
      const teacher = req.body;
      try {
        const result = await teachersCollection.insertOne(teacher);
        res.status(201).json({
          message: 'Teacher added successfully',
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error("Error inserting teacher:", error);
        res.status(500).json({ message: 'Failed to insert teacher', error });
      }
    });

    // create api for get teacher data
    app.get('/teacher', async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({ message: 'Email is required as query parameter' });
      }

      try {
        const teacher = await teachersCollection.findOne({ email: email });

        if (!teacher) {
          return res.status(404).json({ message: 'Teacher not found' });
        }

        res.status(200).json(teacher);
      } catch (error) {
        console.error("Error fetching teacher:", error);
        res.status(500).json({ message: 'Failed to get teacher', error });
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
