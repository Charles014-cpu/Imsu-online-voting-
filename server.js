const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve HTML files

// Initialize SQLite Database
const db = new sqlite3.Database('./votes.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Create tables if they don't exist
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            matric TEXT UNIQUE NOT NULL,
            has_voted INTEGER DEFAULT 0,
            voted_for TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('Error creating students table:', err);
        else console.log('Students table ready');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            candidate TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id)
        )
    `, (err) => {
        if (err) console.error('Error creating votes table:', err);
        else console.log('Votes table ready');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            department TEXT,
            votes INTEGER DEFAULT 0
        )
    `, (err) => {
        if (err) console.error('Error creating candidates table:', err);
        else console.log('Candidates table ready');
        
        // Insert default candidates
        db.run("INSERT OR IGNORE INTO candidates (name, department) VALUES (?, ?)", 
            ['John Okafor', 'Computer Science']);
        db.run("INSERT OR IGNORE INTO candidates (name, department) VALUES (?, ?)", 
            ['Mary Eze', 'Information Technology']);
        db.run("INSERT OR IGNORE INTO candidates (name, department) VALUES (?, ?)", 
            ['David Obi', 'Software Engineering']);
    });
}

// ============ ROUTES ============

// 1. LOGIN ENDPOINT - Verify student credentials
app.post('/api/login', (req, res) => {
    const { email, matric } = req.body;

    if (!email || !matric) {
        return res.status(400).json({ success: false, message: 'Email and matric required' });
    }

    // Check if student already voted
    db.get(
        'SELECT * FROM students WHERE email = ? AND matric = ?',
        [email, matric],
        (err, row) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }

            if (row) {
                if (row.has_voted) {
                    return res.status(403).json({ 
                        success: false, 
                        message: 'You have already voted!',
                        already_voted: true 
                    });
                }
                // Student exists and hasn't voted
                return res.json({ 
                    success: true, 
                    message: 'Login successful',
                    student_id: row.id 
                });
            }

            // New student - Register them
            db.run(
                'INSERT INTO students (email, matric) VALUES (?, ?)',
                [email, matric],
                function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, message: 'Registration failed' });
                    }
                    res.json({ 
                        success: true, 
                        message: 'Registered successfully',
                        student_id: this.lastID 
                    });
                }
            );
        }
    );
});

// 2. GET CANDIDATES ENDPOINT
app.get('/api/candidates', (req, res) => {
    db.all('SELECT * FROM candidates', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, candidates: rows });
    });
});

// 3. CAST VOTE ENDPOINT
app.post('/api/vote', (req, res) => {
    const { student_id, candidate } = req.body;

    if (!student_id || !candidate) {
        return res.status(400).json({ success: false, message: 'Student ID and candidate required' });
    }

    // Check if student already voted
    db.get('SELECT has_voted FROM students WHERE id = ?', [student_id], (err, row) => {
        if (err || !row) {
            return res.status(500).json({ success: false, message: 'Student not found' });
        }

        if (row.has_voted) {
            return res.status(403).json({ success: false, message: 'You have already voted!' });
        }

        // Record the vote
        db.run(
            'INSERT INTO votes (student_id, candidate) VALUES (?, ?)',
            [student_id, candidate],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Failed to cast vote' });
                }

                // Update student status and candidate vote count
                db.run(
                    'UPDATE students SET has_voted = 1, voted_for = ? WHERE id = ?',
                    [candidate, student_id]
                );

                db.run(
                    'UPDATE candidates SET votes = votes + 1 WHERE name = ?',
                    [candidate]
                );

                res.json({ success: true, message: 'Vote recorded successfully' });
            }
        );
    });
});

// 4. GET RESULTS ENDPOINT (Admin/Public)
app.get('/api/results', (req, res) => {
    db.all('SELECT name, department, votes FROM candidates ORDER BY votes DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        const total = rows.reduce((sum, candidate) => sum + candidate.votes, 0);
        
        res.json({ 
            success: true, 
            results: rows,
            total_votes: total 
        });
    });
});

// 5. GET VOTE COUNT
app.get('/api/vote-count', (req, res) => {
    db.get('SELECT COUNT(*) as total FROM votes', (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, total_votes: row.total });
    });
});

// ============ START SERVER ============
app.listen(PORT, () => {
    console.log(`✅ Voting server running on http://localhost:${PORT}`);
    console.log(`📊 View results at http://localhost:${PORT}/results.html`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) console.error('Database close error:', err);
        process.exit(0);
    });
});
