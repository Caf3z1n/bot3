import express from 'express';
import cors from 'cors';

import routes from './src/routes.js';

// Central HTTP application for Bot2.
const app = express();

app.use(cors());
app.use(express.json());
app.use(routes);

export default app;
