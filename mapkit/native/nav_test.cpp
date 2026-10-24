// nav_test.exe: NavRoute.h alone, for the checks (native/check_routes.py): the routes of a list of queries on a walkable
// area, to compare with the UnrealScript steps they replace.
//
//     nav_test <file>     file: the number of polygons, then one a line as the editor bakes them ("nv x y z ... n ..."),
//                         then the number of queries, then one a line "ax ay az bx by bz"
// One line a query on stdout: the number of corners, then x y z of each (9 significant digits: the floats exactly).
#include <cstdio>
#include <vector>

#include "NavRoute.h"

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: nav_test <file>\n");
        return 2;
    }
    FILE* f = std::fopen(argv[1], "r");
    if (!f) {
        std::fprintf(stderr, "cannot open %s\n", argv[1]);
        return 2;
    }
    int count = 0;
    if (std::fscanf(f, "%d", &count) != 1 || count < 0)
        return 2;                                       // more than MaxPolys: read, the router keeps the first ones
    const int corners = nav::MaxPolys * nav::MaxSides;
    std::vector<unsigned char> sides(nav::MaxPolys, 0);
    std::vector<float> x(corners, 0), y(corners, 0), z(corners, 0);
    std::vector<int> across(corners, 0);
    for (int p = 0; p < count; p++) {
        int n = 0;
        if (std::fscanf(f, "%d", &n) != 1)
            return 2;
        std::vector<int> nums(4 * (n > 0 ? n : 0));
        for (int& v : nums)
            if (std::fscanf(f, "%d", &v) != 1)
                return 2;
        if (n < 3 || n > nav::MaxSides || p >= nav::MaxPolys)
            continue;                                   // as navbake.fields: Sides 0
        sides[p] = (unsigned char)n;
        for (int k = 0; k < n; k++) {
            x[p * nav::MaxSides + k] = (float)nums[3 * k];
            y[p * nav::MaxSides + k] = (float)nums[3 * k + 1];
            z[p * nav::MaxSides + k] = (float)nums[3 * k + 2];
            across[p * nav::MaxSides + k] = nums[3 * n + k];
        }
    }
    nav::Polygons polys = {count, sides.data(), x.data(), y.data(), z.data(), across.data()};
    nav::Router router(polys);
    int queries = 0;
    if (std::fscanf(f, "%d", &queries) != 1)
        return 2;
    for (int q = 0; q < queries; q++) {
        nav::Vec a, b, out[nav::MaxCorners];
        if (std::fscanf(f, "%f %f %f %f %f %f", &a.X, &a.Y, &a.Z, &b.X, &b.Y, &b.Z) != 6)
            return 2;
        int n = router.Route(a, b, out);
        std::printf("%d", n);
        for (int i = 0; i < n; i++)
            std::printf(" %.9g %.9g %.9g", out[i].X, out[i].Y, out[i].Z);
        std::printf("\n");
    }
    std::fclose(f);
    return 0;
}
