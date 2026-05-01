-- Run this entire file in MySQL Workbench
-- First create and select the database
CREATE DATABASE IF NOT EXISTS eduvault;
USE eduvault;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('student', 'teacher') NOT NULL DEFAULT 'student',
  roll_number VARCHAR(20) NULL,        -- students only
  department VARCHAR(100) NULL,        -- teachers only
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Resources table
CREATE TABLE IF NOT EXISTS resources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  subject VARCHAR(50) NOT NULL,
  topic VARCHAR(100) NOT NULL,
  file_name VARCHAR(255) NOT NULL,     -- original file name
  file_path VARCHAR(500) NOT NULL,     -- path on disk
  file_size VARCHAR(20) NOT NULL,
  file_type VARCHAR(10) NOT NULL,      -- PDF, DOC, PPT etc.
  uploader_id INT NOT NULL,
  download_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Downloads log table (for audit trail - NFR requirement)
CREATE TABLE IF NOT EXISTS download_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resource_id INT NOT NULL,
  user_id INT NOT NULL,
  downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
