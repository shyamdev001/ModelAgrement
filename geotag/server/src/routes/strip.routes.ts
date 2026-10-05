import { Router } from 'express';
import { resolveLocation } from '../services/geocodingService';
import { plusCodeFor } from '../services/plusCodeService';
import { renderStripSvg } from '../services/stripRenderer';
import { UserError } from '../utils/errors';
import { makeStamp } from '../utils/timezone';

export const stripRoutes = Router();

/**
 * Makes the strip for a photo of the given width. The photo itself never comes here:
 * the browser joins the strip to the photo on the person's own device.
 */
stripRoutes.post('/', async (req, res, next) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');

    const width = Number(body.width);
    if (!Number.isInteger(width) || width < 50 || width > 20000) {
      throw new UserError('malformed', 'Something was wrong with that photo. Please choose it again.');
    }
    const locationText = text('location').slice(0, 120);
    const hasId = body.locationId !== undefined && body.locationId !== null && body.locationId !== '';
    const locationId = Number(body.locationId);
    if (!locationText && !hasId) throw new UserError('location_empty', 'Please enter a village, town or city name.');
    if (hasId && (!Number.isInteger(locationId) || locationId < 1)) {
      throw new UserError('malformed', 'Something was wrong with that request. Please try again.');
    }

    const stamp = makeStamp(text('date'), text('time'));
    const location = await resolveLocation(locationText, hasId ? locationId : undefined);
    const plusCode = plusCodeFor(location.latitude, location.longitude);
    const strip = renderStripSvg({ width, location, plusCode, stamp });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      location: [location.name, location.state, location.country].filter(Boolean).join(', '),
      name: location.name,
      taluka: location.taluka,
      district: location.district,
      state: location.state,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
      plusCode,
      date: stamp.date,
      time: stamp.time,
      timezone: stamp.timezone,
      source: location.source,
      stripWidth: width,
      stripHeight: strip.height,
      stripSvg: strip.svg,
    });
  } catch (err) {
    next(err);
  }
});
