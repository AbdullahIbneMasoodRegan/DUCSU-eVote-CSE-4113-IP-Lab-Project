// M1 — request validation with zod (frozen signature).
//
//   router.post('/x', validate({ body: z.object({ regNo: z.string() }) }), handler)
//
// Parsed (and coerced/stripped) values replace req.body / req.params / req.query,
// so handlers only ever see validated data.
import { ZodError } from 'zod';
import { badRequest } from '../errors.js';

export function validate({ body, params, query } = {}) {
  return function validator(req, res, next) {
    try {
      if (params) req.params = params.parse(req.params ?? {});
      if (query) {
        // Express 5 exposes req.query as a getter, so redefine it.
        Object.defineProperty(req, 'query', {
          value: query.parse(req.query ?? {}),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (body) req.body = body.parse(req.body ?? {});
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return next(badRequest('VALIDATION_ERROR', 'Some fields are invalid.', details));
      }
      next(err);
    }
  };
}

export default validate;
