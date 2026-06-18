const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: ['https://pcsadmportal.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/questiondb';

let cachedConnection = null;

async function connectDB() {
  if (cachedConnection) return cachedConnection;
  const connection = await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  });
  cachedConnection = connection;
  console.log('MongoDB Connected Successfully');
  return connection;
}

// ==================== COUNTER FOR ATOMIC ID GENERATION ====================
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', CounterSchema);

// Atomic function to get next sequence number(s) for a collection
async function getNextSequence(collectionName, count = 1) {
  const counter = await Counter.findOneAndUpdate(
    { _id: collectionName },
    { $inc: { seq: count } },
    { new: true, upsert: true }
  );
  return counter.seq - count + 1; // starting ID for the batch
}

// ==================== SCHEMAS & MODELS ====================
const QuestionSchema = new mongoose.Schema({
  _id: { type: Number }, // Auto-generated sequential ID
  exam: { type: String, required: true },
  year: { type: Number, required: true },
  paper: { type: String },
  english: {
    question: { type: String, required: true },
    options: { type: Object, required: true }
  },
  hindi: {
    question: { type: String, required: true },
    options: { type: Object, required: true }
  },
  marks: { type: Number, default: 2 },
  negativeMarks: { type: Number, default: 0.66 },
  correct_answer: { type: Number, required: true },
  subject: { type: String },
  topic: { type: String },
  batchId: { type: String }
}, { timestamps: true });

const PcsQuestion = mongoose.model('PcsQuestion', QuestionSchema, 'pcsquestions');
const BookQuestion = mongoose.model('BookQuestion', QuestionSchema, 'bookquestions');

const collections = {
  pcsquestions: PcsQuestion,
  bookquestions: BookQuestion
};

// ==================== MIDDLEWARE ====================
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

app.post('/api/login', async (req, res) => {
  const { admin_id, admin_pass } = req.body;
  if (admin_id === 'admin' && admin_pass === 'admin123') {
    const token = jwt.sign({ id: admin_id }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// ==================== PROTECTED ROUTES ====================
app.post('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const data = req.body;
    const batchId = 'batch_' + Date.now();

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return res.json({ message: 'No questions to upload', count: 0 });
      }

      // Atomically get next sequential IDs for the entire batch
      const startId = await getNextSequence(collection, data.length);

      const questionsWithBatch = data.map((q, index) => {
        // Ignore any question_id / _id coming from the uploaded file
        const { _id: ignoredId, question_id: ignoredQId, ...rest } = q;
        return {
          ...rest,
          _id: startId + index,
          batchId
        };
      });

      await Model.insertMany(questionsWithBatch);

      return res.json({ 
        message: 'Questions uploaded successfully', 
        count: data.length, 
        batchId,
        idRange: { start: startId, end: startId + data.length - 1 }
      });
    }

    // Single question upload
    const startId = await getNextSequence(collection, 1);
    const { _id: ignoredId, question_id: ignoredQId, ...rest } = data;
    
    const doc = new Model({ 
      ...rest, 
      _id: startId, 
      batchId 
    });
    
    await doc.save();
    
    res.json({ 
      message: 'Question added successfully', 
      doc,
      generatedId: startId 
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all questions
app.get('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const { limit = 100, skip = 0, year, exam, batchId } = req.query;
    const filter = {};
    if (year) filter.year = parseInt(year);
    if (exam) filter.exam = exam;
    if (batchId) filter.batchId = batchId;

    const questions = await Model.find(filter)
      .sort({ _id: 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    res.json(questions);
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single question by ID
app.get('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, id } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const question = await Model.findById(parseInt(id));
    if (!question) return res.status(404).json({ error: 'Question not found' });

    res.json(question);
  } catch (error) {
    console.error('Single Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, id } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const updated = await Model.findByIdAndUpdate(
      parseInt(id), 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!updated) return res.status(404).json({ error: 'Question not found' });
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
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const deleted = await Model.findByIdAndDelete(parseInt(id));
    if (!deleted) return res.status(404).json({ error: 'Question not found' });
    
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/questions/:collection/batch/:batchId', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, batchId } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const result = await Model.deleteMany({ batchId });
    res.json({ 
      message: 'Batch deleted successfully', 
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Batch Delete Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
