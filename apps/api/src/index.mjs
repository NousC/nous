// Proply REST API — v1 endpoints
// See CLAUDE.md for full route list and architecture notes
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// TODO: mount v1 routes from packages/core
// import { contactRoutes } from '@proply/core';
// app.use('/v1', contactRoutes);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Proply API running on :${PORT}`));
