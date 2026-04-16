import { FastifyInstance, FastifyBaseLogger, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import { TypeBoxTypeProvider, FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

// 1. Define the custom FastifyInstance type with TypeBoxTypeProvider
export type FastifyTypebox = FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    FastifyBaseLogger,
    TypeBoxTypeProvider
>;

// 2. Export the utility type for async plugins (recommended for routes)
export type FastifyRoutePlugin<Options extends Record<string, any> = Record<never, never>> = FastifyPluginAsyncTypebox<Options>;
