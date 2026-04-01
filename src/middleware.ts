import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware((context, next) => {
  context.locals.runtime = context.locals.runtime || {};
  return next();
});
