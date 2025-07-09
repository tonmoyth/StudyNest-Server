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

    // update user profile
    app.patch('/users/update', async (req, res) => {
      const { email, phone } = req.body;
      console.log(email, phone)

      try {
        const result = await usersCollection.updateOne(
          { email: email },
          { $set: { phone: phone } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'Phone number updated successfully' });
      } catch (error) {
        console.error("Error updating phone number:", error);
        res.status(500).json({ message: 'Failed to update phone number', error });
      }
    });

    // create api for get all user
    app.get('/users', async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: 'Failed to get users', error });
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

    // user make admin
    app.patch("/users/make-admin", async (req, res) => {
      const { email } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });

    // users search
    app.get('/users/search', async (req, res) => {
      const query = req.query.query;

      const searchRegex = new RegExp(query, 'i');

      const users = await usersCollection.find({
        $or: [
          {
            name: { $regex: searchRegex }
          },
          {
            email: { $regex: searchRegex }
          }
        ]
      }).toArray();
      res.status(200).send(users);
    })

    // user get for profile route show
    app.get('/users/profile', async (req, res) => {
      const email = req.query.email;

      try {
        const user = await usersCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: 'Failed to get user', error });
      }
    });

    // create post api for insert teacher
    app.post('/teacher', async (req, res) => {
      const teacher = req.body;

      if (!teacher.email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      try {
        // Check if teacher already exists by email
        const existingTeacher = await teachersCollection.findOne({ email: teacher.email });

        if (existingTeacher) {
          // Teacher exists, update status to "pending"
          const updateResult = await teachersCollection.updateOne(
            { email: teacher.email },
            { $set: { status: 'pending' } }
          );

          return res.status(200).json({
            message: 'Teacher already exists, status set to pending',
            modifiedCount: updateResult.modifiedCount
          });
        } else {
          // Teacher does not exist, insert new with status = pending

          const insertResult = await teachersCollection.insertOne(teacher);

          return res.status(201).json({
            message: 'New teacher added successfully',
            insertedId: insertResult.insertedId
          });
        }
      } catch (error) {
        console.error('Error handling teacher post:', error);
        res.status(500).json({ message: 'Something went wrong', error });
      }
    });

    // create api for get teacher data
    app.get('/teacher', async (req, res) => {
      const email = req.query.email;
      console.log(email);

      if (!email) {
        return res.status(400).json({ message: 'Email is required as query parameter' });
      }

      try {
        const teacher = await teachersCollection.findOne({ email: email });

        if (!teacher) {
          return res.send(null);
        }

        res.status(200).json(teacher);
      } catch (error) {
        console.error("Error fetching teacher:", error);
        res.status(500).json({ message: 'Failed to get teacher', error });
      }
    });

    // create api for get all teacher
    app.get('/teachers', async (req, res) => {
      try {
        const teachers = await teachersCollection.find().toArray();
        res.status(200).json(teachers);
      } catch (error) {
        console.error("Error fetching teachers:", error);
        res.status(500).json({ message: 'Failed to get teachers', error });
      }
    });


    // create patch api for teacher accept
    app.patch('/teachers/accept', async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      try {
        // 1. Update teacher's status
        const teacherUpdate = await teachersCollection.updateOne(
          { email: email },
          { $set: { status: 'accepted' } }
        );

        // 2. Update user's role
        const userUpdate = await usersCollection.updateOne(
          { email: email },
          { $set: { role: 'teacher' } }
        );

        if (teacherUpdate.matchedCount === 0) {
          return res.status(404).json({ message: 'Teacher not found' });
        }

        res.status(200).json({
          message: 'Teacher status updated to accepted and user role set to teacher'
        });
      } catch (error) {
        console.error("Error updating teacher status and user role:", error);
        res.status(500).json({ message: 'Failed to update status and role', error });
      }
    });

    // create patch api for teacher rejected
    app.patch('/teachers/reject', async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      try {
        // 1. Update teacher's status to "rejected"
        const teacherUpdate = await teachersCollection.updateOne(
          { email: email },
          { $set: { status: 'rejected' } }
        );

        // 2. Update user's role to "user"
        const userUpdate = await usersCollection.updateOne(
          { email: email },
          { $set: { role: 'user' } }
        );

        if (teacherUpdate.matchedCount === 0) {
          return res.status(404).json({ message: 'Teacher not found' });
        }

        res.status(200).json({
          message: 'Teacher status updated to rejected and user role set to user'
        });
      } catch (error) {
        console.error("Error updating teacher status and user role:", error);
        res.status(500).json({ message: 'Failed to reject teacher', error });
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
