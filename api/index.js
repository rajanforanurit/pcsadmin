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
const CAMONGODB_URI = process.env.CAMONGODB_URI || 'mongodb://localhost:27017/currentaffairsdb';
const ITMONGODB_URI = process.env.ITMONGODB_URI || 'mongodb://localhost:27017/importanttopicsdb';

let cachedQuestionConn = null;
let cachedCAConn = null;
let cachedITConn = null;

async function connectQuestionDB() {
  if (cachedQuestionConn) return cachedQuestionConn;
  const conn = await mongoose.createConnection(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  }).asPromise();
  cachedQuestionConn = conn;
  console.log('Question MongoDB Connected');
  return conn;
}

async function connectCADB() {
  if (cachedCAConn) return cachedCAConn;
  const conn = await mongoose.createConnection(CAMONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  }).asPromise();
  cachedCAConn = conn;
  console.log('Current Affairs MongoDB Connected');
  return conn;
}

async function connectITDB() {
  if (cachedITConn) return cachedITConn;
  const conn = await mongoose.createConnection(ITMONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  }).asPromise();
  cachedITConn = conn;
  console.log('Important Topics MongoDB Connected');
  return conn;
}

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { collection: 'counters' });

const QuestionSchema = new mongoose.Schema({
  _id: { type: Number },
  exam: { type: String, required: true },
  year: { type: Number, required: true },
  paper: { type: String },
  subject: { type: String, required: true, trim: true },
  topic: { type: String, trim: true },
  imageUrl: { type: String, trim: true, default: null },
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
  explanation: { type: String },
  batchId: { type: String }
}, { timestamps: true });

const CurrentAffairSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  date: { type: String, required: true },
  subject: { type: String, required: true, trim: true },
  imgUrl: { type: String, trim: true, default: null },
  overview: { type: String, required: true },
  highlights: { type: [String], default: [] }
}, { timestamps: true });

const ImportantTopicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subject: { type: String, required: true },
  points: [{ type: String, required: true }]
}, { timestamps: true });

async function getQuestionModels() {
  const conn = await connectQuestionDB();
  const Counter = conn.models.Counter || conn.model('Counter', CounterSchema, 'counters');
  const PcsQuestion = conn.models.PcsQuestion || conn.model('PcsQuestion', QuestionSchema, 'pcsquestions');
  const BookQuestion = conn.models.BookQuestion || conn.model('BookQuestion', QuestionSchema, 'bookquestions');
  const ParagraphQuestion = conn.models.ParagraphQuestion || conn.model('ParagraphQuestion', QuestionSchema, 'paragraphquestions');
  return { Counter, PcsQuestion, BookQuestion, ParagraphQuestion };
}

async function getCAModel() {
  const conn = await connectCADB();
  return conn.models.CurrentAffair || conn.model('CurrentAffair', CurrentAffairSchema, 'ca_articles');
}

async function getITModel() {
  const conn = await connectITDB();
  return conn.models.ImportantTopic || conn.model('ImportantTopic', ImportantTopicSchema, 'important_topics');
}

async function getNextSequence(Counter, collectionName, count = 1) {
  const result = await Counter.findOneAndUpdate(
    { _id: `questions_${collectionName}` },
    { $inc: { seq: count } },
    { new: true, upsert: true }
  );
  return result.seq - count + 1;
}

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

app.post('/api/login', (req, res) => {
  const { admin_id, admin_pass } = req.body;
  if (!admin_id || !admin_pass) {
    return res.status(400).json({ error: 'Admin ID and password are required' });
  }
  if (admin_id !== ADMIN_ID || admin_pass !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Invalid Admin ID or password' });
  }
  const token = jwt.sign(
    { admin_id, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ message: 'Login successful', token });
});

app.get('/api/admin/questions/:collection/batch/:batchId/full', authMiddleware, async (req, res) => {
  try {
    const { Counter, PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection, batchId } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const questions = await Model.find({ batchId }).sort({ _id: 1 });
    if (questions.length === 0) return res.status(404).json({ error: 'Batch not found or empty' });

    const cleanBatch = questions.map(q => {
      const { _id, batchId, createdAt, updatedAt, __v, ...cleanQuestion } = q.toObject();
      return cleanQuestion;
    });

    res.json({ message: 'Batch JSON retrieved successfully', batchId, count: cleanBatch.length, questions: cleanBatch });
  } catch (error) {
    console.error('Fetch Full Batch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    const { Counter, PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const data = req.body;
    const batchId = `batch_${Date.now()}`;

    if (Array.isArray(data)) {
      if (data.length === 0) return res.json({ message: 'No questions', count: 0 });
      const startId = await getNextSequence(Counter, collection, data.length);
      const preparedQuestions = data.map((q, index) => {
        const { _id, question_id, id, ...rest } = q;
        return { ...rest, _id: startId + index, batchId, subject: rest.subject || 'Uncategorized' };
      });
      await Model.insertMany(preparedQuestions);
      return res.json({ message: 'Questions uploaded successfully', count: data.length, batchId, idRange: { start: startId, end: startId + data.length - 1 } });
    }

    const startId = await getNextSequence(Counter, collection, 1);
    const { _id, question_id, id, ...rest } = data;
    const doc = new Model({ ...rest, _id: startId, batchId, subject: rest.subject || 'Uncategorized' });
    await doc.save();
    res.json({ message: 'Question added successfully', generatedId: startId });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    const { PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const { limit = 100, skip = 0, year, exam, subject, batchId } = req.query;
    const filter = {};
    if (year) filter.year = parseInt(year);
    if (exam) filter.exam = exam;
    if (subject) filter.subject = subject;
    if (batchId) filter.batchId = batchId;

    const questions = await Model.find(filter).sort({ _id: 1 }).skip(parseInt(skip)).limit(parseInt(limit));
    res.json(questions);
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    const { PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection, id } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const question = await Model.findById(parseInt(id));
    if (!question) return res.status(404).json({ error: 'Question not found' });
    res.json(question);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    const { PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection, id } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const updated = await Model.findByIdAndUpdate(parseInt(id), req.body, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Question not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/questions/:collection/:id', authMiddleware, async (req, res) => {
  try {
    const { PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection, id } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const deleted = await Model.findByIdAndDelete(parseInt(id));
    if (!deleted) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/questions/:collection/batch/:batchId', authMiddleware, async (req, res) => {
  try {
    const { PcsQuestion, BookQuestion, ParagraphQuestion } = await getQuestionModels();
    const collections = { pcsquestions: PcsQuestion, bookquestions: BookQuestion, paragraphquestions: ParagraphQuestion };

    const { collection, batchId } = req.params;
    const Model = collections[collection];
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const result = await Model.deleteMany({ batchId });
    res.json({ message: 'Batch deleted successfully', deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/current-affairs', authMiddleware, async (req, res) => {
  try {
    const CurrentAffair = await getCAModel();
    const data = req.body;

    if (Array.isArray(data)) {
      if (data.length === 0) return res.json({ message: 'No items', count: 0 });
      const docs = await CurrentAffair.insertMany(data);
      return res.status(201).json({ message: 'Current affairs uploaded successfully', count: docs.length });
    }

    const doc = new CurrentAffair(data);
    await doc.save();
    res.status(201).json({ message: 'Current affair added successfully', data: doc });
  } catch (error) {
    console.error('Current Affairs Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/current-affairs', authMiddleware, async (req, res) => {
  try {
    const CurrentAffair = await getCAModel();
    const { limit = 50, skip = 0, subject, date, search } = req.query;

    const filter = {};
    if (subject) filter.subject = subject;
    if (date) filter.date = date;
    if (search) filter.title = { $regex: search, $options: 'i' };

    const [items, total] = await Promise.all([
      CurrentAffair.find(filter).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)),
      CurrentAffair.countDocuments(filter)
    ]);

    res.json({ total, count: items.length, data: items });
  } catch (error) {
    console.error('Current Affairs Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/current-affairs/:id', authMiddleware, async (req, res) => {
  try {
    const CurrentAffair = await getCAModel();
    const item = await CurrentAffair.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Current affair not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/current-affairs/:id', authMiddleware, async (req, res) => {
  try {
    const CurrentAffair = await getCAModel();
    const updated = await CurrentAffair.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Current affair not found' });
    res.json({ message: 'Updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/current-affairs/:id', authMiddleware, async (req, res) => {
  try {
    const CurrentAffair = await getCAModel();
    const deleted = await CurrentAffair.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Current affair not found' });
    res.json({ message: 'Current affair deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/current-affairs', authMiddleware, async (req, res) => {
  try {
    const CurrentAffair = await getCAModel();
    const { date, subject } = req.query;
    if (!date && !subject) return res.status(400).json({ error: 'Provide at least date or subject to bulk delete' });

    const filter = {};
    if (date) filter.date = date;
    if (subject) filter.subject = subject;

    const result = await CurrentAffair.deleteMany(filter);
    res.json({ message: 'Bulk delete successful', deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/important-topics', authMiddleware, async (req, res) => {
  try {
    const ImportantTopic = await getITModel();
    const data = req.body;

    if (Array.isArray(data)) {
      if (data.length === 0) return res.json({ message: 'No items', count: 0 });
      const docs = await ImportantTopic.insertMany(data);
      return res.status(201).json({ message: 'Important topics uploaded successfully', count: docs.length });
    }

    const doc = new ImportantTopic(data);
    await doc.save();
    res.status(201).json({ message: 'Important topic added successfully', data: doc });
  } catch (error) {
    console.error('Important Topics Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/important-topics', authMiddleware, async (req, res) => {
  try {
    const ImportantTopic = await getITModel();
    const { limit = 50, skip = 0, subject, search } = req.query;

    const filter = {};
    if (subject) filter.subject = subject;
    if (search) filter.title = { $regex: search, $options: 'i' };

    const [items, total] = await Promise.all([
      ImportantTopic.find(filter).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)),
      ImportantTopic.countDocuments(filter)
    ]);

    res.json({ total, count: items.length, data: items });
  } catch (error) {
    console.error('Important Topics Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/important-topics/:id', authMiddleware, async (req, res) => {
  try {
    const ImportantTopic = await getITModel();
    const item = await ImportantTopic.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Important topic not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/important-topics/:id', authMiddleware, async (req, res) => {
  try {
    const ImportantTopic = await getITModel();
    const updated = await ImportantTopic.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Important topic not found' });
    res.json({ message: 'Updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/important-topics/:id', authMiddleware, async (req, res) => {
  try {
    const ImportantTopic = await getITModel();
    const deleted = await ImportantTopic.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Important topic not found' });
    res.json({ message: 'Important topic deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/important-topics', authMiddleware, async (req, res) => {
  try {
    const ImportantTopic = await getITModel();
    const { subject } = req.query;
    if (!subject) return res.status(400).json({ error: 'Provide subject to bulk delete' });

    const result = await ImportantTopic.deleteMany({ subject });
    res.json({ message: 'Bulk delete successful', deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
