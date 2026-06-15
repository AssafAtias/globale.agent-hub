"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_js_1 = require("../src/app.js");
const environment_js_1 = require("../src/config/environment.js");
describe('GET /health', () => {
    it('returns 200 ok', async () => {
        const app = (0, app_js_1.buildApp)((0, environment_js_1.loadConfig)());
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok' });
    });
});
