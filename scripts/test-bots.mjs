/**
 * Bot script: connects 3 AI bots to the MonopDeal server.
 * - Bot "Alice" creates a room
 * - Bots "Bob" and "Charlie" join
 * - Prints the room code for the human player to join
 * - Once 4 players are in, the host starts the game
 * - Bots auto-play their turns (draw, play cards, end turn)
 */

import { io } from 'socket.io-client';

const SERVER = process.env.SERVER_URL || 'http://localhost:3003';
const BOT_NAMES = ['Alice', 'Bob', 'Charlie'];
const ROOM_NAME = 'Test Partie';

const bots = [];
let roomId = null;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function createBot(name) {
  return new Promise((resolve) => {
    const socket = io(SERVER, { transports: ['websocket', 'polling'] });
    const bot = { name, socket, hand: [], gameState: null };

    socket.on('connect', () => {
      console.log(`  [${name}] connected (${socket.id})`);
      resolve(bot);
    });

    socket.on('game:hand', (hand) => {
      bot.hand = hand;
    });

    socket.on('game:state', (state) => {
      bot.gameState = state;
    });

    socket.on('game:notification', () => {});

    socket.on('error', (msg) => {
      console.log(`  [${name}] error: ${msg}`);
    });

    socket.on('disconnect', () => {
      console.log(`  [${name}] disconnected`);
    });

    bots.push(bot);
  });
}

async function main() {
  console.log('\n🎲 MonopDeal Test Bots\n');
  console.log(`Connecting to ${SERVER}...\n`);

  const [alice, bob, charlie] = await Promise.all(BOT_NAMES.map(createBot));
  await sleep(300);

  // Alice creates the room
  alice.socket.emit('room:create', { playerName: 'Alice', roomName: ROOM_NAME });
  await new Promise((resolve) => {
    alice.socket.once('room:created', (room) => {
      roomId = room.id;
      console.log(`\n╔══════════════════════════════════════════════╗`);
      console.log(`║  Room created: "${room.name}"`);
      console.log(`║  CODE: ${roomId}`);
      console.log(`║`);
      console.log(`║  Open http://localhost:5173 in your browser`);
      console.log(`║  Enter your name, then join with code above`);
      console.log(`╚══════════════════════════════════════════════╝\n`);
      resolve();
    });
  });

  await sleep(200);
  bob.socket.emit('room:join', { playerName: 'Bob', roomId });
  await sleep(200);
  charlie.socket.emit('room:join', { playerName: 'Charlie', roomId });
  await sleep(200);

  console.log('  Waiting for you to join...\n');

  // Wait for 4th player
  await new Promise((resolve) => {
    alice.socket.on('room:updated', (room) => {
      console.log(`  Players in room: ${room.players.map(p => p.name).join(', ')} (${room.players.length}/4)`);
      if (room.players.length >= 4) resolve();
    });
  });

  await sleep(500);
  console.log('\n  Starting the game...\n');
  alice.socket.emit('game:start');
  await sleep(1000);

  console.log('  Bots are now auto-playing their turns.');
  console.log('  Press Ctrl+C to stop.\n');

  // Auto-play loop
  while (true) {
    await sleep(1500);

    for (const bot of bots) {
      if (!bot.gameState) continue;
      if (bot.gameState.phase === 'finished') {
        const winner = bot.gameState.players.find(p => p.id === bot.gameState.winnerId);
        console.log(`\n  Game over! Winner: ${winner?.name || 'unknown'}`);
        process.exit(0);
      }

      const currentPlayer = bot.gameState.players[bot.gameState.currentPlayerIndex];
      if (currentPlayer?.id !== bot.socket.id) continue;

      // Handle pending action responses first
      if (bot.gameState.pendingAction) {
        const pa = bot.gameState.pendingAction;
        if (pa.targetPlayerIds.includes(bot.socket.id) && !pa.respondedPlayerIds.includes(bot.socket.id)) {
          await sleep(800);
          const me = bot.gameState.players.find(p => p.id === bot.socket.id);
          if (me) {
            const payableIds = [
              ...me.bank.map(c => c.id),
              ...me.propertySets.flatMap(s =>
                s.cards.filter(c => !(c.type === 'property_wildcard' && c.colors === 'all'))
                  .map(c => c.id)
              ),
            ];
            bot.socket.emit('game:respond', { accept: true, paymentCardIds: payableIds.slice(0, 2) });
          }
        }
        continue;
      }

      const turnPhase = bot.gameState.turnPhase;

      if (turnPhase === 'draw') {
        await sleep(600);
        console.log(`  [${bot.name}] drawing cards...`);
        bot.socket.emit('game:draw');
        await sleep(800);
        continue;
      }

      if (turnPhase === 'discard') {
        if (bot.hand.length > 7) {
          const toDiscard = bot.hand.slice(7).map(c => c.id);
          console.log(`  [${bot.name}] discarding ${toDiscard.length} card(s)...`);
          bot.socket.emit('game:discard', { cardIds: toDiscard });
          await sleep(500);
        }
        continue;
      }

      if (turnPhase === 'action') {
        let actionsPlayed = 0;

        for (const card of [...bot.hand]) {
          if (actionsPlayed >= 2) break;

          if (card.type === 'property') {
            console.log(`  [${bot.name}] plays property: ${card.name}`);
            bot.socket.emit('game:play-card', { cardId: card.id });
            actionsPlayed++;
            await sleep(700);
            continue;
          }

          if (card.type === 'property_wildcard') {
            const color = card.colors === 'all' ? 'brown' : card.colors[0];
            console.log(`  [${bot.name}] plays wildcard as ${color}`);
            bot.socket.emit('game:play-card', { cardId: card.id, color });
            actionsPlayed++;
            await sleep(700);
            continue;
          }

          if (card.type === 'money') {
            console.log(`  [${bot.name}] banks ${card.value}M`);
            bot.socket.emit('game:play-card', { cardId: card.id, asMoney: true });
            actionsPlayed++;
            await sleep(700);
            continue;
          }

          if (card.type === 'action' && card.actionType === 'pass_go') {
            console.log(`  [${bot.name}] plays Pass Go`);
            bot.socket.emit('game:play-card', { cardId: card.id });
            actionsPlayed++;
            await sleep(700);
            continue;
          }

          if (card.type === 'action' && card.actionType === 'its_my_birthday') {
            console.log(`  [${bot.name}] plays It's My Birthday`);
            bot.socket.emit('game:play-card', { cardId: card.id });
            actionsPlayed++;
            await sleep(1500);
            await handleBirthdayResponses(bot);
            continue;
          }

          // Bank other action/rent cards as money
          if (card.type === 'action' || card.type === 'rent') {
            console.log(`  [${bot.name}] banks ${card.name} (${card.value}M)`);
            bot.socket.emit('game:play-card', { cardId: card.id, asMoney: true });
            actionsPlayed++;
            await sleep(700);
            continue;
          }
        }

        await sleep(500);
        console.log(`  [${bot.name}] ends turn`);
        bot.socket.emit('game:end-turn');
        await sleep(500);
      }
    }

    // Handle pending actions for non-current-turn bots
    for (const bot of bots) {
      if (!bot.gameState?.pendingAction) continue;
      const pa = bot.gameState.pendingAction;
      if (pa.targetPlayerIds.includes(bot.socket.id) && !pa.respondedPlayerIds.includes(bot.socket.id)) {
        await sleep(600);
        const me = bot.gameState.players.find(p => p.id === bot.socket.id);
        if (me) {
          const payableIds = [
            ...me.bank.map(c => c.id),
            ...me.propertySets.flatMap(s =>
              s.cards.filter(c => !(c.type === 'property_wildcard' && c.colors === 'all'))
                .map(c => c.id)
            ),
          ];
          console.log(`  [${bot.name}] responding to pending action...`);
          bot.socket.emit('game:respond', { accept: true, paymentCardIds: payableIds.slice(0, 3) });
        }
      }
    }
  }
}

async function handleBirthdayResponses(sourceBot) {
  await sleep(500);
  for (const bot of bots) {
    if (bot.socket.id === sourceBot.socket.id) continue;
    const me = bot.gameState?.players.find(p => p.id === bot.socket.id);
    if (!me) continue;
    const payableIds = [
      ...me.bank.map(c => c.id),
      ...me.propertySets.flatMap(s =>
        s.cards.filter(c => !(c.type === 'property_wildcard' && c.colors === 'all'))
          .map(c => c.id)
      ),
    ];
    if (payableIds.length > 0) {
      bot.socket.emit('game:respond', { accept: true, paymentCardIds: payableIds.slice(0, 1) });
    } else {
      bot.socket.emit('game:respond', { accept: true, paymentCardIds: [] });
    }
    await sleep(300);
  }
}

process.on('SIGINT', () => {
  console.log('\n\n  Disconnecting bots...');
  for (const bot of bots) bot.socket.disconnect();
  process.exit(0);
});

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
