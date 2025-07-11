require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    const classesCollection = database.collection("classes");
    const paymentsCollection = database.collection("payments");

    // POST /create-payment-intent
    app.post('/create-payment-intent', async (req, res) => {
      const { amountCent } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amountCent),
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // create api for update user role and update enrolment and inserted payment info
    app.post('/enroll', async (req, res) => {
      const paymenInfoData = req.body;
      const { email, classId } = paymenInfoData;

      if (!email || !classId || !paymenInfoData) {
        return res.status(400).json({ message: 'Email, classId, and paymentInfo are required' });
      }

      try {
        // 1. Update user role to 'student'
        const userUpdateResult = await usersCollection.updateOne(
          { email: email },
          { $set: { role: 'student' } }
        );

        // 2. Increment enrollments field in classesCollection
        const classUpdateResult = await classesCollection.updateOne(
          { _id: new ObjectId(classId) },
          { $inc: { enrollments: 1 } }
        );

        // 3. Insert payment info into paymentsCollection
        // const paymentDoc = {
        //   email,
        //   classId: new ObjectId(classId),
        //   ...paymentInfo,
        //   paymentDate: new Date()
        // };

        const paymentInsertResult = await paymentsCollection.insertOne(paymenInfoData);

        res.status(200).json({
          message: 'Enrollment completed successfully',
          userUpdated: userUpdateResult.modifiedCount > 0,
          classUpdated: classUpdateResult.modifiedCount > 0,
          paymentInsertedId: paymentInsertResult.insertedId
        });

      } catch (error) {
        console.error('Enrollment error:', error);
        res.status(500).json({ message: 'Enrollment failed', error });
      }
    });

    // create api for user info insert 
    app.post("/users", async (req, res) => {
      const user = req.body;


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

    // create api for get classes aprove
    app.get('/classes/approved', async (req, res) => {
      try {
        const approvedClasses = await classesCollection
          .find({ status: "approved" })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(approvedClasses);
      } catch (error) {
        console.error("Error fetching approved classes:", error);
        res.status(500).json({ message: 'Failed to get approved classes', error });
      }
    });

    // create api for get single class
    app.get('/classes/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const classData = await classesCollection.findOne({ _id: new ObjectId(id) });

        if (!classData) {
          return res.status(404).json({ message: 'Class not found' });
        }

        res.status(200).json(classData);
      } catch (error) {
        console.error("Error fetching class by ID:", error);
        res.status(500).json({ message: 'Failed to get class', error });
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

    // create api for added teacher class
    app.post('/classes', async (req, res) => {
      const newClass = req.body;

      try {
        const result = await classesCollection.insertOne(newClass);

        res.status(201).json({
          message: 'Class added successfully',
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error("Error inserting class:", error);
        res.status(500).json({ message: 'Failed to add class', error });
      }
    });

    // created api for all classes
    app.get('/classes/all', async (req, res) => {
      try {
        const allClasses = await classesCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(allClasses);
      } catch (error) {
        console.error("Error fetching classes:", error);
        res.status(500).json({ message: 'Failed to get classes', error });
      }
    });

    // PATCH: Approve class
    app.patch("/classes/approve/:id", async (req, res) => {
      const id = req.params.id;
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved" } }
      );
      res.send(result);
    });

    // PATCH: Reject class
    app.patch("/classes/reject/:id", async (req, res) => {
      const id = req.params.id;
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "rejected" } }
      );
      res.send(result);
    });

    // create api for get teacher classes
    app.get('/classes', async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({ message: 'Teacher email is required as query parameter' });
      }

      try {
        const teacherClasses = await classesCollection.find({ email }).toArray();

        res.status(200).json(teacherClasses);
      } catch (error) {
        console.error("Error fetching teacher classes:", error);
        res.status(500).json({ message: 'Failed to get classes', error });
      }
    });

    // create api for update class data
    app.patch('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          title: req.body.title,
          price: req.body.price,
          description: req.body.description,
          // image: req.body.image,
        },
      };
      const result = await classesCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // create api for delete teacher class
    app.delete('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const result = await classesCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
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
