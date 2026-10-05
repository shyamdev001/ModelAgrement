import { Router } from 'express';
import { describe, searchLocal } from '../services/locationService';

export const locationRoutes = Router();

/** Suggestions for the location box. Answers from the bundled database only; never goes online. */
locationRoutes.get('/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  const results = searchLocal(query).map((location) => ({ ...location, label: describe(location) }));
  res.json({ results });
});
