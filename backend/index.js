// Serve admin dashboard at /api/admin/dashboard
// (Moved below app initialization)

const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const DBConnection = require('./config/connect')
const path = require("path");
const fs = require('fs')

const app = express()
dotenv.config()

//////connection of DB/////////
DBConnection()

const PORT = process.env.PORT 


//////middleware/////////
app.use(express.json())
app.use(cors())


const uploadsDir = path.join(__dirname, "uploads");
// Create uploads folder if it doesnâ€™t exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve admin login page at /api/admin
app.get('/api/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve admin dashboard at /api/admin/dashboard
app.get('/api/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Serve admin login page at /api/admin
app.get('/api/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});


///ROUTES///
app.use('/api/admin', require('./routers/adminRoutes'))
app.use('/api/user', require('./routers/userRoutes'))
app.use('/api/bookmarks', require('./routers/courseBookmarkRoutes'))
app.use('/api/reviews', require('./routers/courseReviewRoutes'))



app.listen(PORT, () => console.log(`running on ${PORT}`))
