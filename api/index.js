const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');   // ← Added

const app = express();

// ==================== CORS FIX FOR VERCEL ====================
app.use(cors({
  origin: ['https://pcsadmportal.vercel.app', 'http://localhost:3000', '*'], // Add your frontend URL
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/questiondb';

// Global connection cache
let cachedConnection = null;

async function connectDB() {
  if (cachedConnection) return cachedConnection;
  try {
    const connection = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 5,
    });
    cachedConnection = connection;
    console.log('MongoDB Connected Successfully');
    return connection;
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    throw err;
  }
}

// ==================== SCHEMA ====================
const QuestionSchema = new mongoose.Schema({
  exam: { type: String, required: true },
  year: { type: Number, required: true },
  question_no: { type: Number, required: true },

  english: {
    question: { type: String, required: true },
    options: { type: [String], required: true }
  },

  hindi: {
    question: { type: String, required: true },
    options: { type: [String], required: true }
  },

  marks: { type: Number, default: 2 },
  negativeMarks: { type: Number, default: 0.66 },
  answer: { type: Number, default: null },

  paper: String,
  subject: String,
  topic: String
}, { timestamps: true });

// Models
const PcsQuestion = mongoose.model('PcsQuestion', QuestionSchema, 'pcsquestions');
const BookQuestion = mongoose.model('BookQuestion', QuestionSchema, 'bookquestions');

const collections = {
  pcsquestions: PcsQuestion,
  bookquestions: BookQuestion
};

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== ROUTES ====================
app.get('/live', (req, res) => res.status(200).json({ status: 'alive' }));

app.get('/health', async (req, res) => {
  try {
    await connectDB();
    res.status(200).json({ status: 'healthy' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy' });
  }
});

// Login (Hardcoded - you can change later)
app.post('/api/login', async (req, res) => {
  const { admin_id, admin_pass } = req.body;
  
  // Hardcoded credentials (as requested)
  if (admin_id === 'admin' && admin_pass === 'admin123') {
    const token = jwt.sign({ id: admin_id }, JWT_SECRET, { expiresIn: '1h' });
    return res.json({ token });
  }
  
  res.status(401).json({ error: 'Invalid credentials' });
});
// ==================== PROTECTED ADMIN ROUTES ====================
app.post('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({ error: 'Invalid collection. Use pcsquestions or bookquestions' });
    }

    const data = req.body;

    if (Array.isArray(data)) {
      await Model.insertMany(data);
      return res.json({ 
        message: 'Questions uploaded successfully',
        count: data.length 
      });
    }

    const doc = new Model(data);
    await doc.save();
    res.json({ message: 'Question added successfully', doc });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({ error: 'Invalid collection' });
    }

    const { limit = 100, skip = 0, year, exam } = req.query;

    const filter = {};
    if (year) filter.year = parseInt(year);
    if (exam) filter.exam = exam;

    const questions = await Model.find(filter)
      .sort({ year: -1, question_no: 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    res.json(questions);
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, id } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({ error: 'Invalid collection' });
    }

    const updated = await Model.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, id } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({ error: 'Invalid collection' });
    }

    const deleted = await Model.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).json({ error: error.message });
  }
});
module.exports = app;
