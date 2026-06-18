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

// ====================== COUNTER ======================
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { collection: 'counters' });

const Counter = mongoose.model('Counter', CounterSchema);

async function getNextSequence(collectionName, count = 1) {
  const result = await Counter.findOneAndUpdate(
    { _id: `questions_${collectionName}` },
    { $inc: { seq: count } },
    { new: true, upsert: true }
  );
  return result.seq - count + 1;
}

//question schema
const QuestionSchema = new mongoose.Schema({
  _id: { type: Number },
  exam: { type: String, required: true },
  year: { type: Number, required: true },
  paper: { type: String },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  topic: { type: String, trim: true },

  //optional
  imageUrl: {
    type: String,
    trim: true,
    default: null
  },

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
  batchId: { type: String }
}, {
  timestamps: true,
});

// here i make three collections , paragraph question can't fit in normal question schema so I make new collection
const PcsQuestion = mongoose.model('PcsQuestion', QuestionSchema, 'pcsquestions');
const BookQuestion = mongoose.model('BookQuestion', QuestionSchema, 'bookquestions');
const ParagraphQuestion = mongoose.model('ParagraphQuestion', QuestionSchema, 'paragraphquestions');

const collections = {
  pcsquestions: PcsQuestion,
  bookquestions: BookQuestion,
  paragraphquestions: ParagraphQuestion
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
app.get('/api/admin/questions/:collection/batch/:batchId/full', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection, batchId } = req.params;
    const Model = collections[collection];
  
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });
    
    const questions = await Model.find({ batchId }).sort({ _id: 1 });
    
    if (questions.length === 0) {
      return res.status(404).json({ error: 'Batch not found or empty' });
    }

    const cleanBatch = questions.map(q => {
      const { _id, batchId, createdAt, updatedAt, __v, ...cleanQuestion } = q.toObject();
      return cleanQuestion;
    });

    res.json({
      message: 'Batch JSON retrieved successfully',
      batchId,
      count: cleanBatch.length,
      questions: cleanBatch
    });
  } catch (error) {
    console.error('Fetch Full Batch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/questions/:collection', authMiddleware, async (req, res) => {
  try {
    await connectDB();
    const { collection } = req.params;
    const Model = collections[collection];
  
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const data = req.body;
    const batchId = `batch_${Date.now()}`;

    if (Array.isArray(data)) {
      if (data.length === 0) return res.json({ message: 'No questions', count: 0 });
      const startId = await getNextSequence(collection, data.length);
      
      const preparedQuestions = data.map((q, index) => {
        const { _id, question_id, id, ...rest } = q;
        return {
          ...rest,
          _id: startId + index,
          batchId,
          subject: rest.subject || 'Uncategorized'
        };
      });

      await Model.insertMany(preparedQuestions);
      
      return res.json({
        message: 'Questions uploaded successfully',
        count: data.length,
        batchId,
        idRange: { start: startId, end: startId + data.length - 1 }
      });
    }

    const startId = await getNextSequence(collection, 1);
    const { _id, question_id, id, ...rest } = data;
    
    const doc = new Model({
      ...rest,
      _id: startId,
      batchId,
      subject: rest.subject || 'Uncategorized'
    });

    await doc.save();
    
    res.json({
      message: 'Question added successfully',
      generatedId: startId
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
    if (!Model) return res.status(400).json({ error: 'Invalid collection' });

    const { limit = 100, skip = 0, year, exam, subject, batchId } = req.query;
    
    const filter = {};
    if (year) filter.year = parseInt(year);
    if (exam) filter.exam = exam;
    if (subject) filter.subject = subject;
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
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
