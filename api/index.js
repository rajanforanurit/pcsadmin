const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// Environment variables with fallbacks (for local dev)
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/questiondb';

// Global connection cache for Vercel serverless (important!)
let cachedConnection = null;

async function connectDB() {
  if (cachedConnection) {
    return cachedConnection;
  }

  try {
    const connection = await mongoose.connect(MONGODB_URI, {
      // Serverless-friendly options
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 5, // Keep low for serverless
    });
    
    cachedConnection = connection;
    console.log('MongoDB Connected Successfully');
    return connection;
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    throw err;
  }
}

// Models
const QuestionSchema = new mongoose.Schema({
  id: Number,
  year: Number,
  exam: String,
  paper: String,
  language: String,
  question: String,
  options: {
    type: Object
  },
  correct_answer: String
}, { timestamps: true }); // Added timestamps for better tracking

const HindiQuestion = mongoose.model('HindiQuestion', QuestionSchema, 'hindiquestions');
const EnglishQuestion = mongoose.model('EnglishQuestion', QuestionSchema, 'englishquestions');
const BookQuestion = mongoose.model('BookQuestion', QuestionSchema, 'bookquestions');

const collections = {
  hindiquestions: HindiQuestion,
  englishquestions: EnglishQuestion,
  bookquestions: BookQuestion
};

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Public routes (no auth)
app.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', async (req, res) => {
  try {
    await connectDB();
    const dbConnected = mongoose.connection.readyState === 1;
    
    if (!dbConnected) {
      return res.status(503).json({
        status: 'not_ready',
        database: 'disconnected'
      });
    }
    res.status(200).json({
      status: 'ready',
      database: 'connected'
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      database: 'error',
      error: err.message
    });
  }
});

app.get('/health', async (req, res) => {
  try {
    await connectDB();
    const dbConnected = mongoose.connection.readyState === 1;
    
    res.status(dbConnected ? 200 : 503).json({
      status: dbConnected ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbConnected ? 'connected' : 'disconnected',
      environment: process.env.NODE_ENV || 'production'
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: err.message
    });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  const { admin_id, admin_pass } = req.body;

  if (admin_id === 'admin' && admin_pass === 'admin123') {
    const token = jwt.sign(
      { id: admin_id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    return res.json({ token });
  }

  res.status(401).json({ error: 'Invalid credentials' });
});

// Protected Admin Routes
app.post('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    
    const { collection } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({ error: 'Invalid collection' });
    }

    const data = req.body;

    if (Array.isArray(data)) {
      await Model.insertMany(data);
      return res.json({ message: 'Questions uploaded successfully' });
    }

    const doc = new Model(data);
    await doc.save();
    
    res.json({
      message: 'Question added successfully',
      doc
    });
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

    const questions = await Model.find().sort({ id: 1 });
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

    const updated = await Model.findOneAndUpdate(
      { id: parseInt(id) },
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

    const deleted = await Model.findOneAndDelete({ id: parseInt(id) });

    if (!deleted) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// For Vercel serverless
module.exports = app;
