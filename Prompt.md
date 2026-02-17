Role: Act as a Senior Full Stack Engineer and Architect.
Objective: Build a real-time Quiz Buzzer application called "BuzzMaster."

1. Tech Stack Requirements
Framework: Next.js (App Router) or Vite + React.

Styling: Tailwind CSS (Mobile-first design).

Real-time: Socket.io or Fastify with @fastify/websocket.

State Management: React Hooks + Lucide-React for icons.

2. Core Functional Requirements
Create a multi-role system (Quiz Master, Player, Spectator) with the following logic:

Quiz Master (QM) Interface:

Create a room (generates a unique Room ID).

Dashboard viewing all connected players.

Buzzer Management: See who buzzed first (timestamped) and a "Reset All" button.

Text Control: A toggle to "Enable/Disable Player Input" and a "Clear All Inputs" button.

Player Interface:

Join via URL (/room/[id]).

Big, high-contrast Buzzer button (Visual feedback on press).

A text input field that is disabled/read-only unless the QM enables it.

Spectator Interface:

View-only dashboard. See the "Leaderboard" of who buzzed and what players are typing in real-time. No control buttons.

3. System Architecture Requirement: Game State Controller
Implement a gameState object on the server that is broadcasted to all clients. The gameState must include a currentMode string (e.g., 'BUZZER', 'MULTIPLE_CHOICE', 'SLIDER', 'SEQUENCE').

Client-Side Logic: Use a switch statement in the main Player component to render the appropriate UI based on gameState.currentMode.

Socket Events: >     * CHANGE_MODE: QM sends this to switch everyone from Buzzer mode to Multiple Choice.

SUBMIT_PAYLOAD: A generic event for players to send data (whether it's a slider value, an option index, or an ordered array) back to the QM.

Scoreboard: Maintain a persistent scores object in the server state that the QM can manually increment (+1, -1) or set to auto-calculate based on speed/accuracy.

4. WebSocket Logic (Crucial)
Implement a robust socket handler to manage the following events:

JOIN_ROOM: Assigns user to a room and role.

BUZZ_PRESS: Server records the first player to buzz and locks out others until reset.

TEXT_UPDATE: Throttled event to stream player text input to the QM/Spectators.

TOGGLE_INPUT: QM command to enable/disable player text fields.

RESET_ROOM: Clears buzzers and text.

5. UI/UX Specifications
Player View: Extremely minimal. One giant button, one text box. Use "Haptic-like" visual cues (color changes) when the buzzer is active.

Admin View: A grid of cards, one for each player, showing their "Buzzed" status (with rank 1st, 2nd, 3rd) and their current text input.

6. Delivery Instructions
Provide the server.js (or API route) handling the WebSocket logic.

Provide a useQuizStore or custom hook to manage client-side state.

Create the three distinct view components.

Ensure the "First to Buzz" logic is handled server-side to prevent client-side cheating.