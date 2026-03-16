# Video: "I Stopped Reading AI News. I Built This Instead."

**Channel:** Everyday AI with Tristen
**URL:** https://www.youtube.com/watch?v=3dqocMfH72o
**Published:** March 12, 2026
**Duration:** 8:39
**Views:** 428 (at time of capture)

## Description

Every day there are dozens of new AI announcements, research papers, product launches, and headlines. I realized something: trying to read all of it is impossible. So I stopped. Instead, I built an AI system that gathers the latest news, turns it into a podcast, and texts it to me automatically. Every morning I wake up, press one button, and the system pulls articles from trusted sources, generates a podcast using Google's NotebookLM, and sends the audio directly to my phone. No reading. No tabs. No searching. Just press the button and listen.

**Key link:** https://notebooklm.google.com

## Full Transcript

**[0:00]** So, the news around AI is moving faster than anybody can keep up with. And because of that, I stopped reading about AI, but [music] I did build an AI system

**[0:08]** that does it for me. You see, every morning, it pulls the latest AI stories.

**[0:12]** It turns it into a podcast and it has it waiting on my phone via a text message before I even get out of bed. I press one button, just one, and 30 minutes of

**[0:21]** reading, 30 minutes of scanning, 30 minutes of trying to figure out what's actually new is just done for me. And the part of the system that I use the

**[0:29]** most is the one that I almost cut out of this video. If you are new here,

**[0:33]** welcome. I'm Tristan. I'm finishing my doctor degree in technology leadership and I have built over 150 AI agents. And on this channel, we break down AI so you can actually use it in your daily life.

**[0:44]** Okay, so here's how I like to think about it. I think of a coffee maker. A coffee maker doesn't save you time because it brews coffee faster than you

**[0:51]** can do by hand. It brews while you're asleep, right? You set it up the night before. You press a button. you walk away and you wake up and you smell the

**[0:59]** delicious coffee because it's already brewing for you. And that's what I built here, but for AI and news. But that is

**[1:07]** just the tip of the iceberg on how this thing works. In a few minutes, I'm going to play the actual output so you can hear what it sounds like. And I'm

**[1:15]** telling you, most people don't expect the quality that you get here. But first, let me show you how it works. So,

**[1:20]** this is my life dashboard that I've been building. This is a web app that lives on my local server at home. It's basically a home base for all of these

**[1:28]** 150 AI tools that I use every single day. And the news podcast is the very first one here because it's the one that I use the most often at this point. When

**[1:37]** I click it, a window pops open. Today's date is at the top. And below that, you see eight topic cards. There's AI,

**[1:44]** there's tech, there's gadgets, there's world news, US news, sports, good news,

**[1:49]** and custom. When I tap one of these, you see that it highlights it with a colored ring. And then you see a little badge that pops up that shows how many articles it's going to pull. Now, you

**[1:58]** can change that if you want to, but by default, eight is for AI and five is for everything else. And then I hit generate. You start to see that it's

**[2:06]** starting to load. This is the loading screen. And really, that's it. I close the window and I walk away. Everything else happens on its own. But let me tell

**[2:14]** you that there's real magic happening in the back end when I press that button.

**[2:17]** The system is simultaneously hitting seven different RSS feeds at once. For the AI topic, it's looking at OpenAI's

**[2:25]** blog, Anthropic's blog, Google's Deep Mind, Google AI, TechCrunch AI, The Verge AI, and MIT's technology review.

**[2:33]** It grabs the top eight articles from yesterday. And if nothing came out yesterday, it's falling back to the most recent stuff that is available. And for

**[2:41]** every other topic, it's really the same idea. It has a curated RSS feed that's pulling from multiple outlets. Now, if you're wondering what makes this

**[2:48]** different from just opening up Notebook LM yourself, well, first of all, it's the sourcing. I'm not just passing random articles to Notebook LM. These

**[2:57]** are handpicked primary sources. We're talking about the Open AI blog, not a blog about OpenAI, but the actual blog

**[3:04]** itself. Or when Anthropic has its own announcements, it's pulling that information in. When the podcast is talking about something, it's coming

**[3:12]** straight from the source and it's the latest information that's available.

**[3:16]** Second, there's no manual work here. You don't have to open up tabs. You don't have to copy articles. You don't have to paste anything. The system does all of

**[3:24]** that before I even touch my phone. And third of all, it just comes straight to me. I don't have to go looking for it.

**[3:30]** It just shows up as a text message. I tap the link, it plays right there in my browser. There's no app. There's no account. There's nothing to sign up for.

**[3:37]** And the fourth thing, which I'll get to in a minute, is the part where I don't even have to press the button if I don't want to. And my favorite part here is

**[3:44]** the custom topic card because it lets you search for literally anything. You want the latest news on any topic, you put it in there and it's going to pull

**[3:52]** it. And I actually built this assuming that people write like me, which is messy and in a hurry and fast and I'm

**[3:59]** misspelling things because watch what happens here. Before the system even touches an RSS feed, it sends this messy input to Claude Haiku. Haiku is the

**[4:09]** small fastest version of Claude that's out there today. And it's perfect for this exactly quick task because its job here is to figure out exactly what I meant.

**[4:19]** It's going to fix the typos. It's going to pull out the real intent. It's going to come back with two clean search queries. One of which is very specific

**[4:27]** and the other one would be a broader fallback if it can't find any articles on it. And the good thing about it is it takes under a second to use. It costs less than a fraction of a penny to run.

**[4:37]** And the user never has to think about how to phrase a perfect search. And then it searches the news with those two cleaned up queries. It starts with yesterday's news. If nothing's there,

**[4:47]** then it goes back a week. If still nothing, it opens it up further. And then if the first search comes back empty, then it tries the backup query

**[4:55]** and just keeps looking until it finds something that's worth talking about. So most of the time when I'm telling people that I built this AI podcast tool,

**[5:03]** they're picturing a robotic voice reading the headlines. And that's not what this is. And before I get into the engine of what this tool is built on, I want you to hear exactly how it sounds.

**[5:13]** Take a listen.

**[5:14]** "We are specifically looking at eight major stories reported by TechCrunch and The Verge over like the last 24 hours." "Yeah, it's been a busy day."

**[5:22]** "Seriously. And honestly putting these stories side by..." As you heard there, there's two different hosts and they push back on each other and they have this natural pacing and

**[5:30]** they use plain language and that's Google's NotebookLM and that is the thing that is the core of this whole system. So from start to finish, me

**[5:39]** pressing the button until my phone is buzzing with the link, that's really only a few minutes. Then the podcast itself will run 10 to 15 minutes. Oh, and

**[5:47]** there's one more thing here. And I almost forgot to talk about this because I set it up once and then I completely forgot about it. Which, by the way, is kind of the point here, but now my

**[5:56]** mornings look like this. I wake up, I have a text, I put in my earbuds, and I already know what happened in AI overnight before I make my first cup of

**[6:05]** coffee. I don't have time to sit down and read the news every single day. But staying current in this field isn't optional. We have to learn about AI.

**[6:14]** You're probably interested in AI as well. You want to learn about this. So instead of trying to carve out reading time that I don't have, I built this

**[6:22]** system. This system turns it into a listening system for me, something I can do while I'm doing other things. And if you want to start building something like this today, here's exactly what I

**[6:31]** would do. I would go to NotebookLM's website. I would sign up. It's free. It doesn't cost you anything. And I would create a notebook, paste in a few

**[6:39]** articles about something that you care about, hit the audio button, and listen to the quality of the podcast. I just think it's very interesting. And then

**[6:48]** once you have that output, you understand exactly what you're trying to do, you can start building this with Claude Code. If this was useful or interesting to listen to, hit the like button. It only takes 1 second to do it,

**[6:58]** but it does help me out quite a bit. And then subscribe so you can catch the next video when it drops. I'm showing you another piece of my life dashboard every

**[7:07]** single week. So you can learn automation, you can see the tools that I build, you can start building it yourself. And I think it's a really fun

**[7:14]** way to learn AI, which we all know that we need to do. So, thanks for joining and I will see you in the next one.

---

## System Architecture Summary

### Components
1. **Web Dashboard** - Local web app ("life dashboard") with Quick Actions cards
2. **News Podcast Quick Action** - Modal with 8 topic cards + Generate button
3. **RSS Feed Network** - Curated feeds per topic (7 for AI alone)
4. **Claude Haiku** - Cleans messy custom topic input into 2 search queries
5. **NotebookLM** - Google's tool that generates the podcast audio (two AI hosts)
6. **Python Process** - Downloads and validates the audio
7. **SMS Automation** - Texts the podcast link to phone
8. **Scheduler** - Runs the whole thing at 6am automatically

### Topic Cards (8 total)
1. **AI** - OpenAI blog, Anthropic blog, Google DeepMind, Google AI, TechCrunch AI, The Verge AI, MIT Tech Review (8 articles)
2. **Tech** - Silicon Valley and the tech industry (5 articles)
3. **Gadgets** - New devices, reviews, and gear drops (5 articles)
4. **World** - International news and global events (5 articles)
5. **US News** - Top stories across the United States (5 articles)
6. **Sports** - Scores, trades, and highlights (5 articles)
7. **Good News** - Uplifting stories to brighten your day (5 articles)
8. **Custom** - Pick any topic and AI finds the news (5 articles)

### Custom Topic Flow
1. User types messy search query
2. Claude Haiku cleans it → produces 2 queries (specific + broad fallback)
3. System searches news with cleaned queries
4. Falls back from yesterday → last week → further if needed
5. Tries backup query if first comes back empty

### Key Differentiators
- Uses **primary sources** (e.g., OpenAI's actual blog, not blogs about OpenAI)
- **Zero manual work** - no tabs, no copying, no pasting
- **Delivered via text** - tap link, plays in browser
- **Scheduled at 6am** - runs automatically, no button press needed
- **Podcast quality** - two AI hosts with natural pacing, not robotic voice reading
- **10-15 minute** podcast output
- **Few minutes** from button press to phone buzzing

### Tech Stack
- Web app on local server
- RSS feeds for sourcing
- Claude Haiku (Anthropic) for query cleaning
- Google NotebookLM for podcast generation
- Python for audio download/validation
- SMS automation for delivery
- Scheduler (cron-like) for 6am runs
- Built with Claude Code

## Screenshots Captured
1. `02-life-dashboard-1m20s.png` - Full life dashboard with Quick Actions
2. `03-topic-cards-1m40s.png` - News Podcast modal with 8 topic cards
3. `04-topic-selected-1m53s.png` - Topic selected with cyan colored ring
4. `05-loading-screen-2m09s.png` - Tristen explaining backend magic
5. `06-rss-feeds-2m21s.png` - RSS Source Network diagram
6. `07-custom-topic-3m54s.png` - Claude Haiku query cleaning explanation
7. `08-query-cleanup-4m23s.png` - "User never has to phrase a perfect search"
8. `09-notebooklm-core-5m34s.png` - Tristen explaining NotebookLM as core
9. `10-morning-text-5m52s.png` - Tristen describing morning routine
10. `11-morning-routine-6m01s.png` - Morning coffee routine description
11. `12-text-message-3m34s.png` - Custom topic with search input field
