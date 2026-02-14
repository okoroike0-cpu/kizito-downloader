const express = require('express');
const ytdl = require('@distube/ytdl-core');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const http = require('http'); 
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with open CORS
const io = new Server(server, { 
    cors: { origin: "*" } 
});

// ==========================================
// FINAL CORS CONFIGURATION (Optimized for JSZip)
// ==========================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Content-Type', 'Content-Disposition'] 
}));

// --- ENHANCED AGENT SETUP ---
const agent = ytdl.createAgent([
    {
        name: "User-Agent",
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    }
]);

// 1. GET VIDEO INFO
app.get('/info', async (req, res) => {
    try {
        const info = await ytdl.getInfo(req.query.url, { agent });
        
        let selectedFormat = info.formats.find(f => f.itag === 18 || f.itag === '18');
        if (!selectedFormat || !selectedFormat.contentLength) {
            selectedFormat = info.formats.find(f => f.contentLength);
        }

        const sizeInBytes = selectedFormat ? parseInt(selectedFormat.contentLength) : 0;
        const sizeFormatted = sizeInBytes 
            ? (sizeInBytes / (1024 * 1024)).toFixed(2) + " MB" 
            : "Unknown Size";

        res.json({ 
            title: info.videoDetails.title, 
            thumbnail: info.videoDetails.thumbnails[0].url,
            size: sizeFormatted,
            duration: Math.floor(info.videoDetails.lengthSeconds / 60) + ":" + (info.videoDetails.lengthSeconds % 60).toString().padStart(2, '0')
        });
    } catch (err) {
        console.error("Info Error:", err.message);
        res.status(500).json({ error: "YouTube blocked the info request." });
    }
});

// 2. DOWNLOAD & STREAM HANDLER
app.get('/download', async (req, res) => {
    const { url, quality, format, stream, socketId } = req.query;
    const isStreaming = stream === 'true';

    try {
        const info = await ytdl.getInfo(url, { agent });
        const title = info.videoDetails.title.replace(/[^\x00-\x7F]/g, "");

        let itag;
        if (format === 'mp3') {
            itag = undefined; 
        } else {
            if (quality === '1080p') itag = 137; 
            else if (quality === '720p') itag = 22;
            else itag = 18; 
        }

        const options = { 
            quality: itag || 'highestaudio', 
            agent,
            filter: format === 'mp3' ? 'audioonly' : (itag ? undefined : 'audioandvideo')
        };
        
        const downloadStream = ytdl(url, options);

        downloadStream.on('info', (info, format) => {
            if (format.contentLength) {
                res.setHeader('Content-Length', format.contentLength);
            }
            res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
            res.setHeader('Accept-Ranges', 'bytes');
            
            if (!isStreaming) {
                const ext = format === 'mp3' ? 'mp3' : 'mp4';
                res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
            }
        });

        downloadStream.on('error', err => {
            console.error("Stream Error:", err.message);
            if (!res.headersSent) res.status(500).send("Access Forbidden.");
        });

        downloadStream.on('progress', (_, downloaded, total) => {
            const percent = (downloaded / total) * 100;
            if (socketId) io.to(socketId).emit('progress', { percent });
        });

        return downloadStream.pipe(res);

    } catch (error) {
        console.error("Download Error:", error.message);
        if (!res.headersSent) res.status(500).send("Error: " + error.message);
    }
});

// 3. START SERVER (Updated for Render/Vercel)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('-------------------------------------------');
    console.log(`Server online at port ${PORT}`);
    console.log('-------------------------------------------');
});