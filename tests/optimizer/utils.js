/* file : utils.js
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

import { rdf } from '../../src/utils'


export const query = (...where) => {
    return { type: 'query', where }
}
export const bgp = (...triples) => {
    return { type: 'bgp', triples }
}
export const union = (...patterns) => {
    return { type: 'union', patterns }
}
export const group = (...patterns) => {
    return { type: 'group', patterns }
}
export const optional = (...patterns) => {
    return { type: 'optional', patterns }
}
export const filter = (expression) => {
    return { type: 'filter', expression }
}
export const placeholder = (s) => {
    return {
        type: 'bgp',
        triples: [
            {
                subject: rdf.fromN3(s),
                predicate: rdf.fromN3('http://example.org#foo'),
                object: rdf.fromN3('"foo"@en'),
            },
        ],
    }
}
