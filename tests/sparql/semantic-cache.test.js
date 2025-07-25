/* file : semantic-cache-test.js
MIT License

Copyright (c) 2018-2020 Thomas Minier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict'

import { expect } from 'chai'
import { beforeAll, describe, it } from 'vitest'
import { rdf } from '../../src/utils'
import { TestEngine, getGraph } from '../utils'

describe('Semantic caching for SPARQL queries', () => {
    let engine = null
    beforeAll(() => {
        const g = getGraph('./tests/data/dblp.nt')
        engine = new TestEngine(g)
    })

    it('should fill the cache when evaluating a BGP', async () => {
        const query = `
    SELECT ?s ?p ?o WHERE {
      { ?s ?p ?o } UNION { ?s ?p ?o }
    }`
        engine._builder.useCache()
        const results = await engine.execute(query).toArray()
        results.forEach((b) => {
            b = b.toObject()
            expect(b).to.have.keys('?s', '?p', '?o')
        })
        // we have all results in double
        expect(results.length).to.equal(34)
        // check for cache hits
        const bgp = {
            patterns: [
                {
                    subject: rdf.createVariable('?s'),
                    predicate: rdf.createVariable('?p'),
                    object: rdf.createVariable('?o'),
                },
            ],
            graphIRI: engine.defaultGraphIRI(),
        }
        const cache = engine._builder._currentCache
        expect(cache.count()).to.equal(1)
        expect(cache.has(bgp)).to.equal(true)
        // check that the cache is accessible
        await cache.get(bgp).then((content) => {
            expect(content.length).to.equals(17)
        })
    })

    it('should not cache BGPs when the query has a LIMIT modifier', async () => {
        const query = `
    SELECT ?s ?p ?o WHERE {
      { ?s ?p ?o } UNION { ?s ?p ?o }
    } LIMIT 10`
        engine._builder.useCache()
        const results = await engine.execute(query).toArray()
        results.forEach((b) => {
            b = b.toObject()
            expect(b).to.have.keys('?s', '?p', '?o')
        })
        // we have all results
        expect(results.length).to.equal(10)
        // assert that the cache is empty for this BGP
        const bgp = {
            patterns: [{ subject: '?s', predicate: '?p', object: '?o' }],
            graphIRI: engine.defaultGraphIRI(),
        }
        const cache = engine._builder._currentCache
        expect(cache.count()).to.equal(0)
        expect(cache.has(bgp)).to.equal(false)
        // eslint-disable-next-line
        expect(cache.get(bgp)).to.be.null
    })

    it('should not cache BGPs when the query has an OFFSET modifier', async () => {
        const query = `
    SELECT ?s ?p ?o WHERE {
      { ?s ?p ?o } UNION { ?s ?p ?o }
    } OFFSET 10`
        engine._builder.useCache()
        const results = await engine.execute(query).toArray()
        results.forEach((b) => {
            expect(b.toObject()).to.have.keys('?s', '?p', '?o')
        })
        // we have all results in double - 10 (due to then offfset)
        expect(results.length).to.equal(24)
        // assert that the cache is empty for this BGP
        const bgp = {
            patterns: [{ subject: '?s', predicate: '?p', object: '?o' }],
            graphIRI: engine.defaultGraphIRI(),
        }
        const cache = engine._builder._currentCache
        expect(cache.count()).to.equal(0)
        expect(cache.has(bgp)).to.equal(false)
        // eslint-disable-next-line
        expect(cache.get(bgp)).to.be.null
    })
})
