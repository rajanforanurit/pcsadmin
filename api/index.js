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
    maxPoolSize: 5,
  });
  cachedConnection = connection;
  console.log('MongoDB Connected Successfully');
  return connection;
}

const QuestionSchema = new mongoose.Schema({
  _id: { type: Number },
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

app.post('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const data = req.body;
    const batchId = 'batch_' + Date.now();

    if (Array.isArray(data)) {
      const questionsWithBatch = data.map((q, index) => ({
        ...q,
        batchId,
        _id: q._id || undefined
      }));
      await Model.insertMany(questionsWithBatch);
      return res.json({ message: 'Questions uploaded successfully', count: data.length, batchId });
    }

    const doc = new Model({ ...data, batchId });
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

app.patch('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, id } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const updated = await Model.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
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

    const deleted = await Model.findByIdAndDelete(id);
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
    res.json({ message: 'Batch deleted successfully', deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Batch Delete Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
