# Blog Platform with Comments

A full-stack blogging platform built for Task 4.

## Features
- User registration and login with JWT authentication
- Create, read, update and delete blog posts
- Comment on blog posts
- Delete your own comments
- RESTful API with Express
- SQLite database integration
- Responsive React frontend

## Requirements
- Node.js 18+
- npm

## Run the project

### 1. Start the backend
```bash
cd backend
npm install
npm run dev
```

The API runs at `http://localhost:5000`.

### 2. Start the frontend
Open another terminal:
```bash
cd frontend
npm install
npm run dev
```

Open the URL shown by Vite, normally `http://localhost:5173`.

The SQLite database is created automatically in `backend/data/blog.db`.

## API endpoints
- POST `/api/auth/register`
- POST `/api/auth/login`
- GET `/api/posts`
- GET `/api/posts/:id`
- POST `/api/posts`
- PUT `/api/posts/:id`
- DELETE `/api/posts/:id`
- GET `/api/posts/:id/comments`
- POST `/api/posts/:id/comments`
- DELETE `/api/comments/:id`
