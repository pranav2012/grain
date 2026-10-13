use sem_core::parser::graph::EntityGraph;
use sem_core::parser::plugins::create_default_registry;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let repo = std::path::Path::new(&a[1]);
    let reg = create_default_registry();
    let files: Vec<String> = String::from_utf8(std::process::Command::new("git").args(["ls-files"]).current_dir(repo).output().unwrap().stdout).unwrap()
        .lines().filter(|p| reg.get_explicit_plugin(p).is_some()).map(str::to_string).collect();
    let (g, _) = EntityGraph::build(repo, &files, &reg);
    for name in &a[2..] {
        for (id, e) in g.entities.iter().filter(|(_, e)| &e.name == name && e.parent_id.is_none()) {
            let dep = g.dependents().get(id.as_ref() as &str).map(|v| v.len()).unwrap_or(0);
            let uses = g.dependencies().get(id.as_ref() as &str).map(|v| v.len()).unwrap_or(0);
            let users: Vec<String> = g.dependents().get(id.as_ref() as &str).into_iter().flatten().take(4).filter_map(|d| g.entities.get(d)).map(|e| format!("{}@{}", e.name, e.file_path.rsplit('/').next().unwrap())).collect();
            println!("{name} [{}] in {}: used by {dep}, uses {uses}  {:?}", e.entity_type, e.file_path, users);
        }
    }
}
