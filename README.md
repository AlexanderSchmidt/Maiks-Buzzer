# Maiks-Buzzer 🔔

A real-time multiplayer buzzer system for quiz games and game shows, built with React and Socket.IO.

## Features

### 🎮 Multiple Game Modes
- **Buzzer Mode**: Classic buzzer system with two variants:
  - *First Wins*: Locks after the first buzz
  - *Race Mode*: All players can buzz in
- **Multiple Choice**: Quiz master presents 2-4 options, players submit their answers
- **Guess Mode**: Players submit numeric guesses using a slider with customizable range

### 👥 Role System
- **Quiz Master**: Controls the game, manages modes, awards points, and moderates
- **Players**: Participate in the game, buzz in, answer questions, and compete for points
- **Spectators**: View-only mode with secure access link

### 🏆 Competitive Features
- Real-time scoring system with persistent scores
- Optional team mode with customizable team names and colors
- Answer visibility controls (show/hide buzzer order to players)
- Complete game history and action log
- Sound effects for buzzes and game events

### 🌍 Internationalization
- Multi-language support (English & German)
- Automatic language detection
- Easy language switching

## Technology Stack

- **Frontend**: React 19, React Router, Vite, TailwindCSS
- **Backend**: Node.js, Express, Socket.IO
- **UI Icons**: Lucide React
- **i18n**: i18next, react-i18next

## Getting Started

### Prerequisites
- Node.js 18+ or Docker

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Maiks-Buzzer
```

2. Install dependencies:
```bash
npm install
```

### Development

Run both client and server concurrently:
```bash
npm run dev
```

Or run them separately:
```bash
# Terminal 1: Frontend (Vite dev server)
npm run dev:client

# Terminal 2: Backend (Socket.IO server)
npm run dev:server
```

The app will be available at:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

### Production Build

1. Build the frontend:
```bash
npm run build
```

2. Start the production server:
```bash
npm start
```

The server will serve the built frontend and handle WebSocket connections on port 3001.

### Docker Deployment

Build and run using Docker:

```bash
# Build the image
docker build -t maiks-buzzer .

# Run the container
docker run -p 3001:3001 maiks-buzzer
```

Access the app at `http://localhost:3001`

## How to Use

### Creating a Game

1. **Quiz Master Setup**:
   - Enter your name on the home page
   - Click "Create Room" to become the Quiz Master
   - Share the room code with players
   - Share the spectator link for view-only access

2. **Players Joining**:
   - Enter your name and the room code
   - Click "Join as Player"
   - Wait for the Quiz Master to start the game

3. **Game Controls** (Quiz Master):
   - Switch between Buzzer, Multiple Choice, and Guess modes
   - Enable/disable input for players
   - Award or deduct points
   - Enable team mode and assign players to teams
   - Reset buzzes between questions
   - Clear all game state when needed

### Game Modes Explained

#### Buzzer Mode
Players press the buzzer button as fast as they can. The Quiz Master can see the order and timing of buzzes.
- **First Wins**: Only the first player can buzz (classic quiz show style)
- **Race Mode**: All players can buzz in, showing the complete order

#### Multiple Choice
1. Quiz Master enters 2-4 answer options
2. Quiz Master locks the options (makes them visible to players)
3. Players select their answer and submit
4. Quiz Master reveals answers and awards points accordingly

#### Guess Mode
1. Quiz Master sets the min/max range for the slider
2. Quiz Master locks the range (makes it visible to players)
3. Players adjust their guess on the slider and submit
4. Quiz Master reveals all guesses and awards points

### Team Mode
- Quiz Master enables team mode
- Creates teams with custom names and colors
- Assigns players to teams
- Points are tracked both individually and by team

## Project Structure

```
Maiks-Buzzer/
├── public/
│   └── sounds/          # Sound effects
├── src/
│   ├── components/      # React components
│   ├── hooks/          # Custom React hooks (Zustand store)
│   ├── i18n/           # Translation files
│   ├── pages/          # Route pages
│   ├── views/          # Role-specific views
│   ├── App.jsx         # Main app component
│   ├── socket.js       # Socket.IO client setup
│   └── sounds.js       # Sound management
├── server.js           # Express + Socket.IO server
├── Dockerfile          # Docker configuration
└── package.json        # Dependencies and scripts
```

## Configuration

### Server Port
The server runs on port **3001** by default. To change this, modify the `PORT` in [server.js](server.js).

### Socket.IO CORS
CORS is configured to allow all origins in development. For production, update the CORS settings in [server.js](server.js):

```javascript
const io = new Server(server, {
  cors: {
    origin: 'https://your-domain.com',
    methods: ['GET', 'POST'],
  },
});
```

### Disconnect Grace Period
Players have a 10 minutes grace period to reconnect before being fully removed from the room. Adjust `DISCONNECT_GRACE_MS` in [server.js](server.js) if needed.

## Features in Detail

### Session Persistence
- Players receive a session token upon joining
- Can reconnect to the same room if disconnected
- Scores and player state are preserved during brief disconnections

### Takeover Links
- If a player gets disconnected permanently, the Quiz Master can generate a takeover link
- Another person can use this link to assume the disconnected player's identity and score

### Sound Effects
- Buzzer sounds for player buzzes
- Audio feedback for game events
- Can be muted individually

### History Log
- Complete audit log of all game actions
- Timestamps for all events
- Track buzzes, score changes, mode switches, and more

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both client and server in development mode |
| `npm run dev:client` | Start only the Vite dev server |
| `npm run dev:server` | Start only the Node.js server |
| `npm run build` | Build the production bundle |
| `npm start` | Start the production server |
| `npm run preview` | Preview the production build locally |

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

Built with ❤️ for quiz enthusiasts and game show fans
