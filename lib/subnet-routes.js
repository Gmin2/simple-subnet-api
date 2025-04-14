/** @import { RequestWithSubnet } from './typings.js' */
/** @import { FastifyInstance, FastifyReply } from 'fastify' */

import { today } from './date.js'

const subnetRoutesDefaultParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subnet: {
      type: 'string',
      pattern: '^(walrus|arweave|geo-filecoin)$'
    }
  },
  required: ['subnet']
}

/**
 * Define the subnet routes
 * @param {FastifyInstance} app
 */
export const subnetRoutes = (app) => {
  app.post(
    '/:subnet/measurement',
    {
      schema: {
        params: subnetRoutesDefaultParamsSchema,
        body: {
          type: 'object',
          properties: {
            retrievalSucceeded: {
              type: 'boolean'
            }
          },
          required: ['retrievalSucceeded']
        }
      }
    },

    /**
     * @param {RequestWithSubnet<{}, {continent?: string; minerId?: string; days?: number}>} request
     * @param {FastifyReply} reply
     */
    async (request, reply) => {
      const client = await app.pg.connect()
      try {
        await client.query(
          `INSERT INTO daily_measurements (subnet, day, total, successful)
           VALUES ($1, current_date, 1, $2)
           ON CONFLICT (subnet, day)
           DO UPDATE SET total = daily_measurements.total + 1, successful = daily_measurements.successful + $2`,
          [request.params.subnet, /** @type {{ retrievalSucceeded: boolean }} */ (request.body).retrievalSucceeded ? 1 : 0]
        )
      } finally {
        client.release()
      }
    }
  )

  app.get(
    '/:subnet/retrieval-success-rate',
    {
      schema: {
        params: subnetRoutesDefaultParamsSchema,
        querystring: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              format: 'date'
            },
            to: {
              type: 'string',
              format: 'date'
            }
          }
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: {
                  type: 'string',
                  format: 'date'
                },
                total: {
                  type: 'string',
                  format: 'int64',
                  pattern: '^[0-9]*$'
                },
                successful: {
                  type: 'string',
                  format: 'int64',
                  pattern: '^[0-9]*$'
                }
              },
              required: ['total', 'successful']
            }
          }
        }
      }
    },
    /**
     * @param {RequestWithSubnet<{}, {from: string; to: string}>} request
     * @param {FastifyReply} reply
     */
    async (request, reply) => {
      const client = await app.pg.connect()
      const from = request.query.from || today()
      const to = request.query.to || today()
      try {
        const { rows } = await client.query(
          `SELECT day, total, successful FROM daily_measurements
           WHERE subnet = $1 AND day >= $2 AND day <= $3
           GROUP BY subnet, day ORDER BY day`,
          [request.params.subnet, from, to]
        )
        reply.send(rows)
      } finally {
        client.release()
      }
    }
  )

  app.post(
    '/geo-filecoin/measurement',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            retrievalSucceeded: { type: 'boolean' },
            location: { 
              type: 'object',
              properties: {
                continent: { type: 'string' },
                country: { type: 'string' },
                city: { type: 'string' }
              }
            },
            minerId: { type: ['string', 'null'] },
            latency: { type: ['number', 'null'] },
            ttfb: { type: ['number', 'null'] },
            throughput: { type: ['number', 'null'] }
          },
          required: ['retrievalSucceeded']
        }
      }
    },
    async (request, reply) => {
      const client = await app.pg.connect();
      try {
        await client.query(
          `INSERT INTO daily_measurements (subnet, day, total, successful)
           VALUES ('geo-filecoin', current_date, 1, $1)
           ON CONFLICT (subnet, day)
           DO UPDATE SET total = daily_measurements.total + 1, successful = daily_measurements.successful + $1`,
          [(/** @type {{ retrievalSucceeded: boolean }} */ (request.body)).retrievalSucceeded ? 1 : 0]
        );
        
        // Insert detailed geo measurement
        await client.query(
          `INSERT INTO geo_measurements 
           (subnet, day, successful, continent, country, city, 
            latency, ttfb, throughput, miner_id)
           VALUES ('geo-filecoin', current_date, $1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            /** @type {{ retrievalSucceeded: boolean, location?: { continent?: string, country?: string, city?: string }, minerId?: string | null, latency?: number | null, ttfb?: number | null, throughput?: number | null }} */ (request.body).retrievalSucceeded ? 1 : 0,
            (/** @type {{ location?: { continent?: string } }} */ (request.body)).location?.continent || null,
            (/** @type {{ location?: { country?: string } }} */ (request.body)).location?.country || null, 
            (/** @type {{ location?: { city?: string } }} */ (request.body)).location?.city || null,
            (/** @type {{ latency?: number | null }} */ (request.body)).latency || null,
            (/** @type {{ ttfb?: number | null }} */ (request.body)).ttfb || null,
            (/** @type {{ throughput?: number | null }} */ (request.body)).throughput || null,
            (/** @type {{ minerId?: string | null }} */ (request.body)).minerId || null
          ]
        );
        
        reply.code(200).send({ success: true });
      } catch (error) {
        console.error('Error saving geo measurement:', error);
        reply.code(500).send({ success: false, error: 'Database error' });
      } finally {
        client.release();
      }
    }
  );
  
  app.get(
    '/geo-filecoin/stats',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            continent: { type: 'string' },
            minerId: { type: 'string' },
            days: { type: 'integer', minimum: 1, maximum: 90 }
          }
        }
      }
    },
    /**
   * @param {RequestWithSubnet<{}, { continent?: string; minerId?: string; days?: number }>} request
   * @param {FastifyReply} reply
   */
    async (request, reply) => {
      const client = await app.pg.connect();
      try {
        let query = `
          SELECT 
            day, 
            SUM(total) as total_checks,
            SUM(successful) as successful_checks,
            CASE WHEN SUM(total) > 0 
              THEN ROUND((SUM(successful)::float / SUM(total)::float) * 100, 1) 
              ELSE 0 
            END as success_rate,
            continent,
            country,
            AVG(latency) as avg_latency,
            AVG(ttfb) as avg_ttfb,
            miner_id
          FROM geo_measurements
          WHERE subnet = 'geo-filecoin'
        `;
        
        const queryParams = [];
        let paramIndex = 1;
        
        const days = (request.query?.days) || 7; // Default to 7 days
        query += ` AND day >= CURRENT_DATE - INTERVAL '${days} days'`;
        
        if (request.query?.continent) {
          query += ` AND continent = $${paramIndex}`;
          queryParams.push(request.query.continent);
          paramIndex++;
        }
        
        if (request.query?.minerId) {
          query += ` AND miner_id = $${paramIndex}`;
          queryParams.push(request.query.minerId);
          paramIndex++;
        }
        query += ` 
          GROUP BY day, continent, country, miner_id
          ORDER BY day DESC, continent, miner_id
        `;
        
        const { rows } = await client.query(query, queryParams);
        reply.send(rows);
      } catch (error) {
        console.error('Error retrieving geo stats:', error);
        reply.code(500).send({ success: false, error: 'Database error' });
      } finally {
        client.release();
      }
    }
  );
}
