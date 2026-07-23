const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

/**
 * Lekéri egy adott ügyfél email-címével folytatott teljes levelezést
 * (amit tőle kaptunk + amit mi küldtünk neki) — ugyanazzal a Gmail-fiókkal (IMAP),
 * amivel a rendszer az e-maileket is küldi.
 */
async function fetchConversation(customerEmail){
  if(!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD){
    throw new Error('Nincs beállítva GMAIL_USER / GMAIL_APP_PASSWORD.');
  }
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });

  const messages = [];

  await client.connect();
  try {
    // Beérkező levelek az ügyféltől
    await collectFromFolder(client, 'INBOX', { from: customerEmail }, 'inbox', messages);
    // Kimenő levelek az ügyfélnek (a Gmail "Elküldött" mappájából)
    const sentFolder = await findSentFolder(client);
    if(sentFolder){
      await collectFromFolder(client, sentFolder, { to: customerEmail }, 'sent', messages);
    }
  } finally {
    await client.logout();
  }

  messages.sort((a,b) => new Date(a.date) - new Date(b.date));
  return messages;
}

async function findSentFolder(client){
  const list = await client.list();
  const sent = list.find(f => /sent/i.test(f.name) || /elküldött/i.test(f.name));
  return sent ? sent.path : null;
}

async function collectFromFolder(client, folder, searchCriteria, direction, messages){
  let lock;
  try {
    lock = await client.getMailboxLock(folder);
  } catch(e){
    return; // ha a mappa nem érhető el, egyszerűen kihagyjuk
  }
  try {
    const uids = await client.search(searchCriteria, { uid: true });
    if(!uids || uids.length === 0) return;
    // Csak a legutóbbi 30 üzenetet nézzük meg mappánként, hogy ne legyen lassú
    const recentUids = uids.slice(-30);
    for (const uid of recentUids) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if(!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      messages.push({
        direction, // 'inbox' (tőlük jött) vagy 'sent' (mi küldtük)
        date: parsed.date || new Date(),
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        subject: parsed.subject || '(nincs tárgy)',
        text: parsed.text || '',
      });
    }
  } finally {
    lock.release();
  }
}

module.exports = { fetchConversation };
