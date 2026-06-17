const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/questiondb';

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  await mongoose.connect(MONGODB_URI);
  isConnected = true;
}

(async () => {
  try {
    await connectDB();
    console.log('MongoDB Connected');
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
  }
})();

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
});

const HindiQuestion = mongoose.model(
  'HindiQuestion',
  QuestionSchema,
  'hindiquestions'
);

const EnglishQuestion = mongoose.model(
  'EnglishQuestion',
  QuestionSchema,
  'englishquestions'
);

const BookQuestion = mongoose.model(
  'BookQuestion',
  QuestionSchema,
  'bookquestions'
);

const collections = {
  hindiquestions: HindiQuestion,
  englishquestions: EnglishQuestion,
  bookquestions: BookQuestion
};

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

  res.status(401).json({
    error: 'Invalid credentials'
  });
});

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'No token'
    });
  }

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({
      error: 'Invalid token'
    });
  }
};

app.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (req, res) => {
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
});

app.get('/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbConnected ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'production'
  });
});

app.post(
  '/api/admin/questions/:collection',
  authMiddleware,
  async (req, res) => {
    await connectDB();

    const { collection } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({
        error: 'Invalid collection'
      });
    }

    try {
      const data = req.body;

      if (Array.isArray(data)) {
        await Model.insertMany(data);

        return res.json({
          message: 'Questions uploaded'
        });
      }

      const doc = new Model(data);
      await doc.save();

      res.json({
        message: 'Question added',
        doc
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.get(
  '/api/admin/questions/:collection',
  authMiddleware,
  async (req, res) => {
    await connectDB();

    const { collection } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({
        error: 'Invalid collection'
      });
    }

    const questions = await Model.find();

    res.json(questions);
  }
);

app.patch(
  '/api/admin/questions/:collection/:id',
  authMiddleware,
  async (req, res) => {
    await connectDB();

    const { collection, id } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({
        error: 'Invalid collection'
      });
    }

    const updated = await Model.findOneAndUpdate(
      { id: parseInt(id) },
      req.body,
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        error: 'Not found'
      });
    }

    res.json(updated);
  }
);

app.delete(
  '/api/admin/questions/:collection/:id',
  authMiddleware,
  async (req, res) => {
    await connectDB();

    const { collection, id } = req.params;
    const Model = collections[collection];

    if (!Model) {
      return res.status(400).json({
        error: 'Invalid collection'
      });
    }

    const deleted = await Model.findOneAndDelete({
      id: parseInt(id)
    });

    if (!deleted) {
      return res.status(404).json({
        error: 'Not found'
      });
    }

    res.json({
      message: 'Deleted'
    });
  }
);

module.exports = app;
