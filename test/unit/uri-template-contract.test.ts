import * as UriTemplate from '@hyperjump/uri-template';

describe('@hyperjump/uri-template contract', () => {
    describe('parse', () => {
        it('should be a function', () => {
            expect(typeof UriTemplate.parse).toBe('function');
        });
        it('should return an array of segments with type property', () => {
            const result = UriTemplate.parse('/pets/{id}');
            expect(Array.isArray(result)).toBe(true);
            for (const segment of result) {
                expect(segment).not.toBeNull();
                expect(typeof segment).toBe('object');
                expect(typeof segment.type).toBe('string');
            }
        });
        it('should return variable segments with name and explode properties', () => {
            const result = UriTemplate.parse('/pets/{id}');
            const varSegment = result.find(s => Array.isArray(s.variables));
            expect(varSegment).toBeDefined();
            const variable = varSegment?.variables?.[0];
            expect(variable).toBeDefined();
            if (variable === undefined) {
                return;
            }
            expect(typeof variable.name).toBe('string');
            expect(variable.name).toBe('id');
            expect(typeof variable.explode).toBe('boolean');
        });
    });
    describe('expand', () => {
        it('should be a function', () => {
            expect(typeof UriTemplate.expand).toBe('function');
        });
        it('should expand a template string with values', () => {
            const result = UriTemplate.expand('/pets/{id}', { id: '42' });
            expect(result).toBe('/pets/42');
            expect(typeof result).toBe('string');
        });
        it('should expand a pre-parsed AST', () => {
            const ast = UriTemplate.parse('/pets/{id}');
            const result = UriTemplate.expand(ast, { id: '42' });
            expect(result).toBe('/pets/42');
        });
    });
});
