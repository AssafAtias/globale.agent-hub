import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SkillCatalog } from '../../services/SkillCatalog.js';

export function buildSkillsRoutes(skillsDir: string): FastifyPluginAsyncTypebox {
  const catalog = new SkillCatalog(skillsDir);
  return async (app) => {
    app.get('/api/skills', {
      schema: {
        response: {
          200: Type.Array(Type.Object({ name: Type.String(), description: Type.String() })),
        },
      },
    }, async () => catalog.list());
  };
}
