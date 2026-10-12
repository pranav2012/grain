/// Disjoint sets over `0..n` with path compression.
pub(crate) struct Uf(Vec<usize>);

impl Uf {
    pub(crate) fn new(n: usize) -> Self {
        Uf((0..n).collect())
    }
    pub(crate) fn find(&mut self, x: usize) -> usize {
        let p = self.0[x];
        if p == x {
            return x;
        }
        let r = self.find(p);
        self.0[x] = r;
        r
    }
    pub(crate) fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[rb] = ra;
        }
    }
}
