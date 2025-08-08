# Replit.md

## Overview

This is a Telegram bot application called "GUN PARK" designed for typing speed training and assessment. The bot is created by @Kageonightray and allows users to practice typing through the Telegram interface, tracks their performance metrics (WPM, error rates, progression), and generates visual profile cards showing their statistics. The application is a standalone Node.js Telegram bot using in-memory storage.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Bot Architecture
- **Node.js Telegram Bot**: Single file bot implementation using Telegraf library
- **In-Memory Storage**: All user data, test sessions, and results stored in memory using JavaScript Maps
- **Modular Design**: Self-contained bot with all functionality in one file for simplicity

### Core Features
- **User Registration**: Photo upload and username selection for profile creation
- **Typing Tests**: Speed assessment with 1 sentence (first time) or 5 sentences (subsequent tests)
- **Real-time Chronometer**: Live timing during typing tests with millisecond precision
- **Performance Analysis**: AI-powered response analysis for accuracy and WPM calculation
- **Ranking System**: D to S+ ranking based on WPM performance (D: 0-15, C: 16-30, B: 31-45, A: 46-60, S: 61-75, S+: 75+)

### Profile Card Generation
- **Dynamic Visualization**: HTML-to-image conversion using Puppeteer
- **Custom Business Card Style**: Professional design with user photo, stats, and rank
- **Performance Metrics Display**: Best score, average score, minimum score, and error rate percentage

### Test Management System
- **Speed Tests**: Initial assessment (1 sentence) and regular tests (5 sentences)
- **Challenge Mode**: Advanced testing mode with customizable parameters and AI-powered timing
- **Session Tracking**: Persistent storage of test sessions and results
- **Command Support**: 'stop' and 'restart' commands during tests

### Challenge Mode Features
- **Customizable Parameters**: Users can select sentence count (1-15) and WPM target (15-75+)
- **AI-Powered Timing**: Real-time calculation of expected typing time based on sentence complexity and target WPM
- **Automatic Timeout System**: Chronometer with 0.33s tolerance margin that auto-stops when time limit is reached
- **Interactive Flow**: Between each sentence, user confirmation is required before proceeding
- **Success Criteria**: Combines time limits, accuracy requirements (max 20% errors), and WPM targets
- **Comprehensive Analysis**: Detailed performance statistics with success rates and progression tracking
- **Retry Options**: Users can retry failed sentences or continue to next one
- **Performance Tracking**: Challenge results can update user's best score if objective is met

## External Dependencies

### AI Integration
- **OpenRouter API**: Two models used for different purposes:
  - `openai/gpt-oss-20b:free`: Generates 20 random French sentences for typing tests
  - `moonshotai/kimi-k2:free`: Analyzes user responses for accuracy and error rate calculation

### Telegram Platform
- **Telegram Bot API**: Core bot functionality through Telegraf library
- **Rich Media Support**: Profile photo handling and image generation capabilities
- **Inline Keyboards**: Interactive buttons for navigation and test control

### Development Tools
- **Puppeteer**: HTML-to-image conversion for profile card generation
- **Node.js**: Runtime environment for the bot
- **Telegraf**: Telegram Bot framework for Node.js

## Recent Changes (January 2025)

- ✅ **Completed Telegram Bot Implementation**: Full-featured typing speed bot with all requested functionalities
- ✅ **AI Integration**: Successfully integrated OpenRouter API with two models for sentence generation and accuracy analysis
- ✅ **Profile Card Generation**: Implemented Puppeteer-based business card style profile generation with user stats
- ✅ **Real-time Chronometer**: Millisecond precision timing system with live updates during tests
- ✅ **Complete User Journey**: Registration → Photo upload → Username selection → Speed tests → Performance tracking
- ✅ **Ranking System**: D to S+ ranking based on WPM performance with automatic updates
- ✅ **Test Management**: Support for 1 sentence (first test) and 5 sentences (subsequent tests) with stop/restart commands
- ✅ **Hybrid Architecture**: Combined Telegram bot with health check web server for deployment compatibility

### Latest Improvements (January 2025)
- ✅ **Persistent Data Storage**: Implemented JSON file-based storage for users, test sessions, and user states with auto-save every 30 seconds
- ✅ **Profile Editing System**: Added complete profile modification functionality allowing users to change username and profile photo (stats remain protected)
- ✅ **Improved Chronometer Timing**: Added 0.5 second delay before chronometer starts to give users time to read the sentence
- ✅ **Enhanced Responsiveness**: Added immediate callback query acknowledgments to reduce perceived latency on inline button interactions
- ✅ **Graceful Data Persistence**: Automatic data saving on shutdown and periodic saves during operation
- ✅ **Port Configuration Fix**: Resolved server startup issues by properly configuring port settings
- ✅ **AI Sentence Variety**: Improved sentence generation to create truly random and varied content across different topics instead of repetitive programming-focused sentences
- ✅ **Advanced Challenge Mode**: Implemented complete challenge mode with customizable sentence count, WPM targets, AI-powered timing calculations, automatic timeout system, and comprehensive performance analysis