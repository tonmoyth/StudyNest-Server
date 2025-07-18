# 🖥️ StudyNest Server — Backend API

This is the **backend** for the Skillify e-learning platform. It is built with **Express.js**, **MongoDB**, and uses **JWT** for authentication, **Stripe** for payments, and exposes secure RESTful APIs to power the Skillify client app.

## 🚀 Features

- 🔐 **JWT Authentication** (stored in localStorage on client)
- 🧑‍🎓 **Role-based authorization** for Admin, Teacher, and Student
- 🧾 **Stripe Payment Integration**
- 📦 **RESTful API for Classes, Users, Payments, Enrollments, and Assignments**
- ⚙️ **Secure Routes using middleware**
- 📄 **Teacher request, class approval & feedback submission**
- 📊 **Stats endpoint for total users, enrollments, and classes**