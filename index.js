require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const Stripe = require('stripe');
const admin = require("firebase-admin");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const decoded = Buffer.from(process.env.FB_ADMIN_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

// Middleware
const app = express();
app.use(express.json());
app.use(cors());



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

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
    const assignmentsCollection = database.collection("assignments");
    const assignmentSubmissionCollection = database.collection("assignmentsSubmission");
    const feedbackCollection = database.collection("feedbacks");

    // verify firebase
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).send("Unauthorized");
      }
      const token = authHeader.split(" ")[1];

      try {
        const decodedUser = await admin.auth().verifyIdToken(token);
        req.user = decodedUser;
        next();
      } catch (error) {
        return res.status(403).send("Forbidden: Invalid Token");
      }
    }

    // email varify
    const emailVerify = (req, res, next) => {
      const email = req.query.email;
      if (!email || email !== req.user.email) {
        return res.status(403).send("Forbidden: Email mismatch or missing");
      }
      next();
    }

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

    // create api for get all enroll class
    app.get('/enrolled-classes', verifyFirebaseToken, emailVerify, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({ message: 'Email is required as query parameter' });
      }

      try {
        // 1. Get classIds from paymentsCollection where email matches
        const payments = await paymentsCollection.find({ email }).toArray();

        const classIds = payments.map(p => new ObjectId(p.classId));

        if (classIds.length === 0) {
          return res.status(200).json([]); // no enrollments yet
        }

        // 2. Get classes from classesCollection using those classIds
        const enrolledClasses = await classesCollection
          .find({ _id: { $in: classIds } })
          .toArray();

        res.status(200).json(enrolledClasses);
      } catch (error) {
        console.error("Error fetching enrolled classes:", error);
        res.status(500).json({ message: 'Failed to fetch enrolled classes', error });
      }
    });

    // create api for user info insert 
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };

      try {
        const existingUser = await usersCollection.findOne(query);

        if (existingUser) {
          return  // 409 = Conflict
        }

        const result = await usersCollection.insertOne(user);
        return res.status(201).json({ insertedId: result.insertedId });

      } catch (error) {
        console.error("Error inserting user:", error);
        return res.status(500).json({ message: "Failed to insert user", error });
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
    app.get('/users', verifyFirebaseToken, async (req, res) => {
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
    app.get('/users/search', verifyFirebaseToken, async (req, res) => {
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
    app.get('/users/profile', verifyFirebaseToken, emailVerify, async (req, res) => {
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
    app.get('/classes/:id', verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ID format" });
      }
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
    app.get('/teacher', verifyFirebaseToken, emailVerify, async (req, res) => {
      const email = req.query.email;

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

    // get enrollments
    app.get('/classes_enrollments/:id', verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) }

      try {
        // Step 1: Get all classes by teacher email
        const classe = await classesCollection.findOne(query);

        res.send(classe)
      } catch (error) {
        console.error('Error fetching enrollments:', error);
        res.status(500).json({ message: 'Failed to fetch enrollments', error });
      }
    });

    // get assignment count
    app.get('/assignments/count/:id', verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      // const query = {_id: new ObjectId(id)};

      try {
        const assignments = await assignmentsCollection.find({ classId: id }).toArray();

        res.send(assignments)
      } catch (error) {
        console.error("Error counting assignments:", error);
        res.status(500).json({ message: 'Failed to count assignments', error });
      }
    });

    // create api for get assgnment
    app.get('/assignments/:id', verifyFirebaseToken, emailVerify, async (req, res) => {
      const classId = req.params.id;
      const email = req.query.email;

      try {
        // Find all assignments for the class
        const allAssignments = await assignmentsCollection.find({ classId }).toArray();

        // 2️⃣ Find submitted assignmentIds for this student
        const submitted = await assignmentSubmissionCollection.find({
          studentEmail: email
        }).toArray();

        const submittedIds = submitted.map(sub => sub.assignmentId?.toString());

        //  Filter out submitted assignments
        const unsubmittedAssignments = allAssignments.filter(assignment =>
          !submittedIds.includes(assignment._id.toString())
        );

        res.status(200).json(unsubmittedAssignments);
      } catch (error) {
        console.error("Error fetching assignments:", error);
        res.status(500).json({ message: 'Failed to fetch assignments', error });
      }
    });

    // crate api for get submission
    app.get('/assignment-submission-count/:classId', verifyFirebaseToken, async (req, res) => {
      const classId = req.params.classId;

      try {
        const count = await assignmentSubmissionCollection.countDocuments({ classId });

        res.status(200).json({
          classId,
          submissionCount: count
        });
      } catch (error) {
        console.error("Error counting assignment submissions:", error);
        res.status(500).json({ message: 'Failed to count submissions', error });
      }
    });

    // created api for assignment submited
    app.post('/assignment-submit', async (req, res) => {
      const submissionInfo = req.body;
      const { assignmentId } = submissionInfo;

      try {
        // Increment `submission` field in assignmentsCollection
        await assignmentsCollection.updateOne(
          { _id: new ObjectId(assignmentId) },
          { $inc: { submission: 1 } }
        );

        const result = await assignmentSubmissionCollection.insertOne(submissionInfo);

        res.status(201).json({
          message: "Assignment submitted successfully",
          submissionId: result.insertedId
        });
      } catch (error) {
        console.error("Error submitting assignment:", error);
        res.status(500).json({ message: 'Assignment submission failed', error });
      }
    });

    // created api for feedback
    app.post('/feedback', async (req, res) => {
      const feedbackData = req.body;

      try {
        const result = await feedbackCollection.insertOne(feedbackData);
        res.status(201).json({
          message: 'Feedback submitted successfully',
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error("Error inserting feedback:", error);
        res.status(500).json({ message: 'Failed to submit feedback', error });
      }
    });


    // create api for get all teacher
    app.get('/teachers', verifyFirebaseToken, async (req, res) => {
      try {
        const teachers = await teachersCollection.find().toArray();
        res.status(200).json(teachers);
      } catch (error) {
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

        res.status(500).json({ message: 'Failed to reject teacher', error });
      }
    });

    // create post api for added assignment
    app.post('/assignments', async (req, res) => {
      const assignment = req.body;
      try {
        const result = await assignmentsCollection.insertOne(assignment);

        res.status(201).json({
          message: 'Assignment added successfully',
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error("Error inserting assignment:", error);
        res.status(500).json({ message: 'Failed to insert assignment', error });
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

        res.status(500).json({ message: 'Failed to add class', error });
      }
    });

    // created api for all classes
    app.get('/classes_all', verifyFirebaseToken, async (req, res) => {
      try {
        const allClasses = await classesCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).json(allClasses);
      } catch (error) {

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
    app.get('/classes', verifyFirebaseToken, emailVerify, async (req, res) => {
      const email = req.query.email;
      console.log(req.user)
      if (!email) {
        return res.status(400).json({ message: 'Teacher email is required as query parameter' });
      }

      try {
        const teacherClasses = await classesCollection.find({ email }).toArray();

        res.status(200).json(teacherClasses);
      } catch (error) {
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

    // create api for get highly enrollment classes
    app.get('/top-enrolled-classes', async (req, res) => {
      try {
        const topClasses = await classesCollection
          .find({})                      // Find all
          .sort({ enrollments: -1 })     // Sort by enrollments (descending)
          .limit(6)                      // Limit to top 6
          .toArray();

        res.status(200).json(topClasses);
      } catch (error) {
        console.error("Error fetching top enrolled classes:", error);
        res.status(500).json({ message: 'Failed to fetch top classes', error });
      }
    });

    // create api for get all feedback
    app.get('/feedbacks', async (req, res) => {
      try {
        const feedbacks = await feedbackCollection.find({}).toArray();

        res.status(200).json(feedbacks);
      } catch (error) {
        console.error("Error fetching feedbacks:", error);
        res.status(500).json({ message: 'Failed to fetch feedbacks', error });
      }
    });

    // create api for get total user
    app.get('/total-users', async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();

        res.status(200).json({ totalUsers });
      } catch (error) {
        console.error("Error fetching total user count:", error);
        res.status(500).json({ message: 'Failed to fetch user count', error });
      }
    });

    // created api for get total classes
    app.get('/total-classes', async (req, res) => {
      try {
        const totalClasses = await classesCollection.countDocuments();

        res.status(200).json({ totalClasses });
      } catch (error) {
        console.error("Error fetching total class count:", error);
        res.status(500).json({ message: 'Failed to fetch class count', error });
      }
    });

    // create api for get all enrollments
    app.get('/total-enrollments', async (req, res) => {
      try {
        const result = await classesCollection.aggregate([
          {
            $group: {
              _id: null,
              totalEnrollments: { $sum: "$enrollments" }
            }
          },
          {
            $project: {
              _id: 0,
              totalEnrollments: 1
            }
          }
        ]).toArray();

        const total = result[0]?.totalEnrollments || 0;

        res.status(200).json({ totalEnrollments: total });
      } catch (error) {
        console.error("Error fetching total enrollments:", error);
        res.status(500).json({ message: 'Failed to fetch enrollments', error });
      }
    });

    // created api for get top teacher
    app.get('/top-teachers', async (req, res) => {
      try {
        // Step 1: Get top feedbacks sorted by rating
        const feedbacks = await feedbackCollection
          .find({})
          .sort({ rating: -1 }) // assuming "marks" is used as rating
          .limit(20) // limit to top 20 feedbacks
          .toArray();


        const classIds = feedbacks.map(f => new ObjectId(f.classId)).filter(Boolean);


        // Step 2: Get classes by classIds
        const classes = await classesCollection
          .find({ _id: { $in: classIds } })
          .toArray();



        // Step 3: Get teacher emails from classes
        const teacherEmails = [...new Set(classes.map(c => c.email))]; // remove duplicates
        // Step 4: Get teacher details from teachersCollection
        const topTeachers = await teachersCollection
          .find({ email: { $in: teacherEmails } })
          .limit(5)
          .toArray();

        res.status(200).json(topTeachers);
      } catch (error) {
        console.error("Error fetching top teachers:", error);
        res.status(500).json({ message: 'Failed to fetch top teachers', error });
      }
    });

    // create api for get total student
    app.get('/total-students', verifyFirebaseToken, async (req, res) => {
      try {
        const count = await usersCollection.countDocuments({ role: 'student' });

        res.status(200).json({ totalStudents: count });
      } catch (error) {
        console.error("Error fetching student count:", error);
        res.status(500).json({ message: 'Failed to fetch student count', error });
      }
    });

    app.get('/total-teachers', async (req, res) => {
      try {
        const count = await usersCollection.countDocuments({ role: 'teacher' });

        res.status(200).json({ totalTeachers: count });
      } catch (error) {
        console.error("Error fetching teacher count:", error);
        res.status(500).json({ message: 'Failed to fetch teacher count', error });
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
